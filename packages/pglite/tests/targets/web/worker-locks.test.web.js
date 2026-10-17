import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import playwright from 'playwright'

const baseUrl = `http://localhost:${process.env.WS_PORT || 3334}`

describe.each(['chromium', 'firefox', 'webkit'])(
  'worker locks (%s)',
  (engine) => {
    let browser
    beforeAll(async () => {
      browser = await playwright[engine].launch()
    })
    afterAll(async () => {
      await browser?.close()
    })

    async function withTabs(test) {
      const context = await browser.newContext()
      try {
        const openTab = async () => {
          const page = await context.newPage()
          await page.goto(`${baseUrl}/tests/targets/web/blank.html`)
          await page.evaluate(async () => {
            const { PGliteWorker } = await import(
              '../../../dist/worker/index.js'
            )
            globalThis.db = new PGliteWorker(
              new Worker('/tests/targets/web/worker-locks.js', {
                type: 'module',
              }),
            )
            await globalThis.db.query('SELECT 1')
          })
          return page
        }
        const leader = await openTab()
        const errors = []
        leader.on('pageerror', (error) => errors.push(error.message))
        const worker = leader.workers()[0]
        const locksBefore = await worker.evaluate(async () =>
          (await navigator.locks.query()).held.map((lock) => lock.name),
        )
        const follower = await openTab()
        const closeLock = await worker.evaluate(async (before) => {
          return (await navigator.locks.query()).held.find(
            (lock) =>
              lock.name.startsWith('pglite-tab-close:') &&
              !before.includes(lock.name),
          ).name
        }, locksBefore)
        const waitForClose = async () => {
          // Both leader-side close-lock callbacks must have run before granting
          // the departed tab's queued database lock.
          await expect
            .poll(() =>
              worker.evaluate(async (name) => {
                const { pending } = await navigator.locks.query()
                return pending.some((lock) => lock.name === name)
              }, closeLock),
            )
            .toBe(false)
        }
        await test({ leader, follower, worker, waitForClose })
        expect(errors).toEqual([])
      } finally {
        await context.close()
      }
    }

    it.each([
      ['Query', false],
      ['Transaction', false],
      ['Query', true],
      ['Transaction', true],
    ])(
      'releases queued %s locks (close waiting tab: %s)',
      async (kind, closeTab) => {
        await withTabs(async ({ leader, follower, worker, waitForClose }) => {
          await worker.evaluate(async (kind) => {
            const method = `_runExclusive${kind}`
            let started
            const ready = new Promise((resolve) => (started = resolve))
            globalThis.holding = globalThis.pg[method](
              () =>
                new Promise((resolve) => {
                  globalThis.releaseHeld = resolve
                  started()
                }),
            )
            await ready
            // Observe the actual enqueue, not just the follower sending its RPC.
            const original = globalThis.pg[method].bind(globalThis.pg)
            globalThis.queued = new Promise((resolve) => {
              globalThis.pg[method] = (fn) => {
                const result = original(fn)
                globalThis.pg[method] = original
                resolve()
                return result
              }
            })
          }, kind)
          await follower.evaluate((kind) => {
            globalThis.db[`_runExclusive${kind}`](async () => {})
          }, kind)
          await worker.evaluate(() => globalThis.queued)
          if (closeTab) {
            await follower.close()
            await waitForClose()
          }
          await worker.evaluate(async () => {
            globalThis.releaseHeld()
            await globalThis.holding
          })
          await leader.evaluate(() => {
            globalThis.answer = undefined
            globalThis.db.query('SELECT 42 AS answer').then((result) => {
              globalThis.answer = result.rows[0].answer
            })
          })
          await expect
            .poll(() => leader.evaluate(() => globalThis.answer), {
              timeout: 5000,
            })
            .toBe(42)
        })
      },
    )

    it.each(['Query', 'Transaction'])(
      'releases a held %s lock when its tab closes',
      async (kind) => {
        await withTabs(async ({ leader, follower, waitForClose }) => {
          await follower.evaluate((kind) => {
            globalThis.db[`_runExclusive${kind}`](
              () =>
                new Promise(() => {
                  globalThis.lockHeld = true
                }),
            )
          }, kind)
          await follower.waitForFunction(() => globalThis.lockHeld)
          await follower.close()
          await waitForClose()
          const result = await leader.evaluate(() =>
            globalThis.db.query('SELECT 42 AS answer'),
          )
          expect(result.rows).toEqual([{ answer: 42 }])
        })
      },
    )
  },
)
