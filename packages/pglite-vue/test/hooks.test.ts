import { vi, describe, it, expect, beforeEach, beforeAll } from 'vitest'
import { ref } from 'vue-demi'
import { PGlite } from '@electric-sql/pglite'
import { live, PGliteWithLive } from '@electric-sql/pglite/live'
import type { useLiveIncrementalQuery, useLiveQuery } from '../src'

function flushPromises(timeoutMs = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, timeoutMs))
}

let db: PGliteWithLive

describe('hooks', () => {
  beforeAll(async () => {
    // mock db injection
    vi.doMock('vue-demi', async () => {
      const vue = await vi.importActual('vue-demi')
      return {
        ...vue,
        inject: vi.fn((_) => db),
      }
    })
  })

  testLiveQuery('useLiveQuery')

  testLiveQuery('useLiveIncrementalQuery')
})
function testLiveQuery(queryHook: 'useLiveQuery' | 'useLiveIncrementalQuery') {
  describe(queryHook, () => {
    let hookFn: typeof useLiveQuery | typeof useLiveIncrementalQuery
    const incKey = 'id'

    beforeAll(async () => {
      const { useLiveQuery, useLiveIncrementalQuery } = await import('../src')
      hookFn =
        queryHook === 'useLiveQuery' ? useLiveQuery : useLiveIncrementalQuery
    })

    beforeEach(async () => {
      // prepare db for test
      db = await PGlite.create({
        extensions: {
          live,
        },
      })

      await db.exec(`
        CREATE TABLE IF NOT EXISTS test (
          id SERIAL PRIMARY KEY,
          name TEXT
        );
      `)
    })

    it('can receive initial results', async () => {
      await db.exec(`INSERT INTO test (name) VALUES ('test1'),('test2');`)

      const result = hookFn(`SELECT * FROM test`, [], incKey)

      expect(result?.rows?.value).toEqual(undefined)

      await flushPromises()

      expect(result?.rows?.value).toEqual([
        {
          id: 1,
          name: 'test1',
        },
        {
          id: 2,
          name: 'test2',
        },
      ])
      expect(result?.fields?.value).toEqual([
        {
          name: 'id',
          dataTypeID: 23,
        },
        {
          name: 'name',
          dataTypeID: 25,
        },
      ])
    })

    it('can receive changes', async () => {
      await db.exec(`INSERT INTO test (name) VALUES ('test1'),('test2');`)

      const result = hookFn(`SELECT * FROM test`, [], incKey)

      await flushPromises()
      expect(result?.rows?.value).toEqual([
        {
          id: 1,
          name: 'test1',
        },
        {
          id: 2,
          name: 'test2',
        },
      ])

      // detect new inserts
      await db.exec(`INSERT INTO test (name) VALUES ('test3');`)
      await flushPromises()
      expect(result?.rows?.value).toEqual([
        {
          id: 1,
          name: 'test1',
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

      // detect deletes
      await db.exec(`DELETE FROM test WHERE name = 'test1';`)
      await flushPromises()
      expect(result?.rows?.value).toEqual([
        {
          id: 2,
          name: 'test2',
        },
        {
          id: 3,
          name: 'test3',
        },
      ])

      // detect updates
      await db.exec(`UPDATE test SET name = 'foobar' WHERE name = 'test2';`)
      await flushPromises()
      expect(result?.rows?.value).toEqual([
        {
          id: 3,
          name: 'test3',
        },
        {
          id: 2,
          name: 'foobar',
        },
      ])

      // // detect truncates
      // db.exec(`TRUNCATE test;`)
      // await flushPromises()
      // expect(result?.rows?.value).toHaveLength(0)
    })

    it('updates when query ref changes', async () => {
      await db.exec(`INSERT INTO test (name) VALUES ('test1'),('test2');`)

      const query = ref('SELECT * FROM test')

      const result = hookFn(query, [], incKey)

      await flushPromises()
      expect(result?.rows?.value).toHaveLength(2)

      query.value = `SELECT * FROM test WHERE name = 'test1'`

      await flushPromises()
      expect(result?.rows?.value).toHaveLength(1)
    })

    it('updates when query getter changes', async () => {
      await db.exec(`INSERT INTO test (name) VALUES ('test1'),('test2');`)

      const query = ref('SELECT * FROM test')

      const result = hookFn(() => query.value, [], incKey)

      await flushPromises()
      expect(result?.rows?.value).toHaveLength(2)

      query.value = `SELECT * FROM test WHERE name = 'test1'`

      await flushPromises()
      expect(result?.rows?.value).toHaveLength(1)
    })

    it('updates when query parameter ref changes', async () => {
      await db.exec(`INSERT INTO test (name) VALUES ('test1'),('test2');`)

      const params = ref(['test1'])

      const result = hookFn(
        `SELECT * FROM test WHERE name = $1;`,
        params,
        incKey,
      )

      await flushPromises()
      expect(result?.rows?.value).toEqual([
        {
          id: 1,
          name: 'test1',
        },
      ])

      params.value = ['test2']

      await flushPromises()
      expect(result?.rows?.value).toEqual([
        {
          id: 2,
          name: 'test2',
        },
      ])
    })
  })
}
