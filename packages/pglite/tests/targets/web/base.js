import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import playwright from 'playwright'

const wsPort = process.env.WS_PORT || 3334

const BASE_URL = `http://localhost:${wsPort}/tests/targets/web/blank.html`

const PGLITE_PATH = '../../../dist/index.js'
const PGLITE_WORKER_PATH = '../../../dist/worker/index.js'
const PGLITE_LIVE_PATH = '../../../dist/live/index.js'
const WORKER_PATH = '/tests/targets/web/worker.js'

const useWorkerForBbFilename = ['opfs-ahp://base']

export function tests(env, dbFilename, target) {
  describe(`targets ${target}`, () => {
    let browser
    let evaluate
    let context
    let page
    let db
    let evaluationQueue = Promise.resolve()

    async function populateGlobals(page) {
      await page?.evaluate(`
        window.dbFilename = "${dbFilename}";
        window.useWorkerForBbFilename = ${JSON.stringify(useWorkerForBbFilename)};
        window.PGLITE_PATH = "${PGLITE_PATH}";
        window.PGLITE_WORKER_PATH = "${PGLITE_WORKER_PATH}";
        window.PGLITE_LIVE_PATH = "${PGLITE_LIVE_PATH}";
        window.WORKER_PATH = "${WORKER_PATH}";
      `)
    }

    afterAll(async () => {
      if (browser) {
        await browser.close()
      }
    })

    beforeAll(async () => {
      browser = await playwright[env].launch()
      context = await browser.newContext()
      page = await context.newPage()
      await page.goto(BASE_URL)
      await populateGlobals(page)

      page.on('console', (msg) => {
        console.log(msg)
      })

      evaluate = async (fn) => {
        try {
          const resultPromise = evaluationQueue.then(() => page.evaluate(fn))
          evaluationQueue = resultPromise
          return await resultPromise
        } catch (e) {
          console.error(e)
          throw e
        }
      }
    })

    it(`basic`, async () => {
      const res = await evaluate(async () => {
        if (useWorkerForBbFilename.includes(dbFilename)) {
          const { PGliteWorker } = await import(PGLITE_WORKER_PATH)
          db = new PGliteWorker(
            new Worker(WORKER_PATH, {
              type: 'module',
            }),
            {
              dataDir: dbFilename,
            },
          )
        } else {
          const { PGlite } = await import(PGLITE_PATH)
          db = new PGlite(dbFilename)
        }

        await db.waitReady
        await db.query(`
          CREATE TABLE IF NOT EXISTS test (
            id SERIAL PRIMARY KEY,
            name TEXT
          );
        `)
        await db.query("INSERT INTO test (name) VALUES ('test');")
        const res = await db.query(`
          SELECT * FROM test;
        `)
        return res
      })

      expect(res).toMatchObject({
        affectedRows: 0,
        fields: [
          {
            dataTypeID: 23,
            name: 'id',
          },
          {
            dataTypeID: 25,
            name: 'name',
          },
        ],
        rows: [
          {
            id: 1,
            name: 'test',
          },
        ],
      })
    })

    it(`params`, async () => {
      const res = await evaluate(async () => {
        await db.query('INSERT INTO test (name) VALUES ($1);', ['test2'])
        const res = await db.query(`
          SELECT * FROM test;
        `)
        return res
      })

      expect(res).toMatchObject({
        affectedRows: 0,
        fields: [
          {
            dataTypeID: 23,
            name: 'id',
          },
          {
            dataTypeID: 25,
            name: 'name',
          },
        ],
        rows: [
          {
            id: 1,
            name: 'test',
          },
          {
            id: 2,
            name: 'test2',
          },
        ],
      })
    })

    it(`dump data dir and load it`, async () => {
      const res = await evaluate(async () => {
        // Force compression to test that it's working in all environments
        const file = await db.dumpDataDir('gzip')
        const { PGlite } = await import(PGLITE_PATH)
        const db2 = await PGlite.create({
          loadDataDir: file,
        })
        return await db2.query('SELECT * FROM test;')
      })
      expect(res.rows).toEqual([
        {
          id: 1,
          name: 'test',
        },
        {
          id: 2,
          name: 'test2',
        },
      ])
    })

    it(`close`, async () => {
      const err = await evaluate(async () => {
        try {
          await db.close()
        } catch (e) {
          console.error(e)
          return e.message
        }
        return null
      })
      expect(err).toBe(null)
    })

    if (dbFilename === 'memory://') {
      // Skip the rest of the tests for memory:// as it's not persisted
      return
    }

    it(`persisted`, async () => {
      await page?.reload() // Refresh the page
      await populateGlobals(page)

      const res = await evaluate(async () => {
        if (useWorkerForBbFilename.includes(dbFilename)) {
          const { PGliteWorker } = await import(PGLITE_WORKER_PATH)
          db = new PGliteWorker(
            new Worker(WORKER_PATH, {
              type: 'module',
            }),
            {
              dataDir: dbFilename,
            },
          )
        } else {
          const { PGlite } = await import(PGLITE_PATH)
          db = new PGlite(dbFilename)
        }
        await db.waitReady
        const res = await db.query(`
          SELECT * FROM test;
        `)
        return res
      })

      expect(res).toMatchObject({
        affectedRows: 0,
        fields: [
          {
            dataTypeID: 23,
            name: 'id',
          },
          {
            dataTypeID: 25,
            name: 'name',
          },
        ],
        rows: [
          {
            id: 1,
            name: 'test',
          },
          {
            id: 2,
            name: 'test2',
          },
        ],
      })
    })

    it(`worker live query`, async () => {
      const page2 = await context.newPage()
      await page2.goto(BASE_URL)
      await populateGlobals(page2)
      page.on('console', (msg) => {
        console.log(msg)
      })

      const res2Prom = page2.evaluate(async () => {
        const { live } = await import(PGLITE_LIVE_PATH)
        const { PGliteWorker } = await import(PGLITE_WORKER_PATH)

        let db
        db = new PGliteWorker(
          new Worker(WORKER_PATH, {
            type: 'module',
          }),
          {
            dataDir: window.dbFilename,
            extensions: { live },
          },
        )

        await db.waitReady

        let updatedResults
        const eventTarget = new EventTarget()
        const { initialResults } = await db.live.query(
          'SELECT * FROM test ORDER BY name;',
          [],
          (result) => {
            updatedResults = result
            eventTarget.dispatchEvent(new Event('updated'))
          },
        )
        await new Promise((resolve) => {
          eventTarget.addEventListener('updated', resolve)
        })
        return { initialResults, updatedResults }
      })

      const res1 = await evaluate(async () => {
        const { live } = await import(PGLITE_LIVE_PATH)
        const { PGliteWorker } = await import(PGLITE_WORKER_PATH)

        let db
        db = new PGliteWorker(
          new Worker(WORKER_PATH, {
            type: 'module',
          }),
          {
            dataDir: window.dbFilename,
            extensions: { live },
          },
        )

        await db.waitReady

        let updatedResults
        const eventTarget = new EventTarget()
        const { initialResults } = await db.live.query(
          'SELECT * FROM test ORDER BY name;',
          [],
          (result) => {
            updatedResults = result
            eventTarget.dispatchEvent(new Event('updated'))
          },
        )
        await new Promise((resolve) => setTimeout(resolve, 500))
        await db.sql`INSERT INTO test (id, name) VALUES (${3}, ${'test3'});`
        await new Promise((resolve) => {
          eventTarget.addEventListener('updated', resolve)
        })
        return { initialResults, updatedResults }
      })

      const res2 = await res2Prom

      expect(res1.initialResults.rows).toEqual([
        {
          id: 1,
          name: 'test',
        },
        {
          id: 2,
          name: 'test2',
        },
      ])

      for (const res of [res1, res2]) {
        expect(res.updatedResults.rows).toEqual([
          {
            id: 1,
            name: 'test',
          },
          {
            id: 2,
            name: 'test2',
          },
          {
            id: 3,
            name: 'test3',
          },
        ])
      }
    })

    it(`worker live incremental query`, async () => {
      const page2 = await context.newPage()
      await page2.goto(BASE_URL)
      await populateGlobals(page2)
      page.on('console', (msg) => {
        console.log(msg)
      })

      const res2Prom = page2.evaluate(async () => {
        const { live } = await import(PGLITE_LIVE_PATH)
        const { PGliteWorker } = await import(PGLITE_WORKER_PATH)

        let db
        db = new PGliteWorker(
          new Worker(WORKER_PATH, {
            type: 'module',
          }),
          {
            dataDir: window.dbFilename,
            extensions: { live },
          },
        )

        await db.waitReady

        let updatedResults
        const eventTarget = new EventTarget()
        const { initialResults } = await db.live.incrementalQuery(
          'SELECT * FROM test ORDER BY name;',
          [],
          'id',
          (result) => {
            updatedResults = result
            eventTarget.dispatchEvent(new Event('updated'))
          },
        )
        await new Promise((resolve) => {
          eventTarget.addEventListener('updated', resolve)
        })
        return { initialResults, updatedResults }
      })

      const res1 = await evaluate(async () => {
        const { live } = await import(PGLITE_LIVE_PATH)
        const { PGliteWorker } = await import(PGLITE_WORKER_PATH)

        let db
        db = new PGliteWorker(
          new Worker(WORKER_PATH, {
            type: 'module',
          }),
          {
            dataDir: window.dbFilename,
            extensions: { live },
          },
        )

        await db.waitReady

        let updatedResults
        const eventTarget = new EventTarget()
        const { initialResults } = await db.live.incrementalQuery(
          'SELECT * FROM test ORDER BY name;',
          [],
          'id',
          (result) => {
            updatedResults = result
            eventTarget.dispatchEvent(new Event('updated'))
          },
        )
        await new Promise((resolve) => setTimeout(resolve, 500))
        await db.query("INSERT INTO test (id, name) VALUES (4, 'test4');")
        await new Promise((resolve) => {
          eventTarget.addEventListener('updated', resolve)
        })
        return { initialResults, updatedResults }
      })

      const res2 = await res2Prom

      expect(res1.initialResults.rows).toEqual([
        {
          id: 1,
          name: 'test',
        },
        {
          id: 2,
          name: 'test2',
        },
        {
          id: 3,
          name: 'test3',
        },
      ])

      for (const res of [res1, res2]) {
        expect(res.updatedResults.rows).toEqual([
          {
            id: 1,
            name: 'test',
          },
          {
            id: 2,
            name: 'test2',
          },
          {
            id: 3,
            name: 'test3',
          },
          {
            id: 4,
            name: 'test4',
          },
        ])
      }
    })

    if (dbFilename.startsWith('idb://')) {
      it(`idb close and delete`, async () => {
        const res = await evaluate(async () => {
          await db.query('select 1;')
          await db.close()

          const waitForDelete = () =>
            new Promise((resolve, reject) => {
              const req = indexedDB.deleteDatabase(dbFilename)

              req.onsuccess = () => {
                resolve()
              }
              req.onerror = () => {
                reject(
                  req.error
                    ? req.error
                    : 'An unknown error occurred when deleting IndexedDB database',
                )
              }
              req.onblocked = async () => {
                await new Promise((resolve) => setTimeout(resolve, 10))
                resolve(waitForDelete())
              }
            })

          await waitForDelete()

          return true
        })

        expect(res).toBe(true)
      })
    }
  })
}
