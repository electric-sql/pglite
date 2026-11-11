import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import playwright from 'playwright'

const wsPort = process.env.WS_PORT || 3334

const BASE_URL = `http://localhost:${wsPort}/tests/targets/web/blank.html`

const PGLITE_WORKER_PATH = '../../../dist/worker/index.js'
const WORKER_PATH = '/tests/targets/web/worker.js'

// Two `PGliteWorker`s on one page are enough to exercise a real leader change: the election lock
// `pglite-election-lock:${id}` is origin scoped and shared with dedicated workers, so passing the
// same `id` to both makes their workers contend for it. Closing the leader terminates its worker,
// releases the lock, and promotes the other one.
describe('worker leader change', () => {
  let browser
  let page

  beforeAll(async () => {
    browser = await playwright.chromium.launch()
    const context = await browser.newContext()
    page = await context.newPage()
    await page.goto(BASE_URL)
    page.on('console', (msg) => console.log(msg.text()))
    await page.evaluate(`
      window.PGLITE_WORKER_PATH = "${PGLITE_WORKER_PATH}";
      window.WORKER_PATH = "${WORKER_PATH}";
    `)
  })

  afterAll(async () => {
    await browser?.close()
  })

  it('settles a statement that holds the transaction lock', async () => {
    const outcome = await page.evaluate(async () => {
      const { PGliteWorker } = await import(PGLITE_WORKER_PATH)

      const id = `leader-change-${crypto.randomUUID()}`
      const newInstance = async () => {
        const db = await PGliteWorker.create(
          new Worker(WORKER_PATH, { type: 'module' }),
          { id, dataDir: 'memory://' },
        )
        await db.waitReady
        return db
      }

      // Three instances, created in order: the first worker to ask for the election lock is the
      // leader, and `navigator.locks` grants in request order, so when the leader goes away it is
      // the second that takes over. That leaves the third a follower across the change - it sees
      // one `leader-here`, and no `leader-now` of its own that would dispatch a second
      // `leader-change` event.
      const leader = await newInstance()
      const successor = await newInstance()
      const follower = await newInstance()

      // The leader's PGlite boots lazily, and until it is ready every rpc sits queued on
      // `_acquireTransactionLock` - the case that already settles cleanly. Warm up first so the
      // statement below really holds the locks when the leader goes away.
      await follower.query('SELECT 1')

      // In flight on the leader, holding the query and transaction locks while it runs.
      const inFlight = follower.query('SELECT pg_sleep(2)')
      inFlight.catch(() => {}) // settled below; keep an early rejection from going unhandled
      await new Promise((resolve) => setTimeout(resolve, 500))

      const leaderChanged = new Promise((resolve) =>
        follower.onLeaderChange(() => resolve()),
      )
      await leader.close()
      await leaderChanged

      const result = await Promise.race([
        inFlight.then(
          () => 'resolved',
          (error) => `rejected: ${error.message}`,
        ),
        new Promise((resolve) => setTimeout(() => resolve('hung'), 5000)),
      ])

      return { result, successorIsLeader: successor.isLeader }
    })

    expect(outcome).toEqual({
      successorIsLeader: true,
      result:
        'rejected: Leader changed, pending operation in indeterminate state',
    })
  })
})
