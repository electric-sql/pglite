import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook } from '@solidjs/testing-library'
import { waitFor } from '@testing-library/dom'
import { PGlite } from '@electric-sql/pglite'
import { live, PGliteWithLive } from '@electric-sql/pglite/live'
import { PGliteProvider, useLiveQuery, useLiveIncrementalQuery } from '../src'
import { JSX } from 'solid-js/jsx-runtime'
import { Accessor, createRoot, createSignal } from 'solid-js'

describe('hooks', () => {
  testLiveQuery('useLiveQuery')

  testLiveQuery('useLiveIncrementalQuery')

  describe('useLiveQuery with limit and offset', () => {
    let db: PGliteWithLive
    let wrapper: (props: { children: JSX.Element }) => JSX.Element

    beforeEach(async () => {
      db = await PGlite.create({
        extensions: {
          live,
        },
      })
      wrapper = (props) => {
        return <PGliteProvider db={db}>{props.children}</PGliteProvider>
      }

      await db.exec(`
        CREATE TABLE IF NOT EXISTS test (
          id SERIAL PRIMARY KEY,
          name TEXT
        );
      `)
      await db.exec(`TRUNCATE test;`)
    })

    it('query with limit and offset', async () => {
      db.exec(`INSERT INTO test (name) VALUES ('test1'),('test2');`)

      const [opts, setOpts] = createSignal({ limit: 1, offset: 0 })
      const { result } = renderHook(
        (props: { pagination: Accessor<{ limit: number; offset: number }> }) =>
          useLiveQuery({
            query: () => `SELECT * FROM test`,
            pagination: props.pagination,
          }),
        { wrapper, initialProps: [{ pagination: opts }] },
      )

      waitFor(() => expect(result()?.rows).toEqual([{ id: 1, name: 'test1' }]))

      setOpts({ limit: 1, offset: 1 })
      waitFor(() => expect(result()?.rows).toEqual([{ id: 2, name: 'test2' }]))

      setOpts({ limit: 2, offset: 0 })
      waitFor(() =>
        expect(result()?.rows).toEqual([
          { id: 1, name: 'test1' },
          { id: 2, name: 'test2' },
        ]),
      )
    })
  })

  describe('useLiveQuery.sql', () => {
    let db: PGliteWithLive
    let wrapper: (props: { children: JSX.Element }) => JSX.Element

    beforeEach(async () => {
      db = await PGlite.create({
        extensions: {
          live,
        },
      })
      wrapper = (props) => {
        return <PGliteProvider db={db}>{props.children}</PGliteProvider>
      }

      await db.exec(`
        CREATE TABLE IF NOT EXISTS test (
          id SERIAL PRIMARY KEY,
          name TEXT
        );
      `)
      await db.exec(`TRUNCATE test;`)
    })

    it('updates when query parameter changes', async () => {
      await db.exec(`INSERT INTO test (name) VALUES ('test1'),('test2');`)

      const [params, setParams] = createSignal(['test1'])
      const { result } = renderHook(
        (props: { params: Accessor<Array<string>> }) =>
          useLiveQuery.sql`SELECT * FROM test WHERE name = ${() => props.params()[0]};`,
        { wrapper, initialProps: [{ params: params }] },
      )

      await waitFor(() =>
        expect(result()?.rows).toEqual([
          {
            id: 1,
            name: 'test1',
          },
        ]),
      )

      setParams(['test2'])

      await waitFor(() =>
        expect(result()?.rows).toEqual([
          {
            id: 2,
            name: 'test2',
          },
        ]),
      )
    })
  })
})

function testLiveQuery(queryHook: 'useLiveQuery' | 'useLiveIncrementalQuery') {
  describe(queryHook, () => {
    let db: PGliteWithLive
    let wrapper: (props: { children: JSX.Element }) => JSX.Element
    const hookFn =
      queryHook === 'useLiveQuery' ? useLiveQuery : useLiveIncrementalQuery
    const incKey = 'id'
    beforeEach(async () => {
      db = await PGlite.create({
        extensions: {
          live,
        },
      })
      wrapper = (props) => {
        return <PGliteProvider db={db}>{props.children}</PGliteProvider>
      }

      await db.exec(`
        CREATE TABLE IF NOT EXISTS test (
          id SERIAL PRIMARY KEY,
          name TEXT
        );
      `)
      await db.exec(`TRUNCATE test;`)
    })

    it('can receive initial results', async () => {
      await db.exec(`INSERT INTO test (name) VALUES ('test1'),('test2');`)

      const { result } = renderHook(
        () =>
          hookFn({
            query: () => `SELECT * FROM test`,
            params: () => [],
            key: () => incKey,
          }),
        { wrapper },
      )

      await waitFor(() => expect(result()).not.toBe(undefined))
      expect(result()).toEqual({
        rows: [
          {
            id: 1,
            name: 'test1',
          },
          {
            id: 2,
            name: 'test2',
          },
        ],
        fields: [
          {
            name: 'id',
            dataTypeID: 23,
          },
          {
            name: 'name',
            dataTypeID: 25,
          },
        ],
      })
    })

    it('can receive changes', async () => {
      await db.exec(`INSERT INTO test (name) VALUES ('test1'),('test2');`)

      const { result } = renderHook(
        () =>
          hookFn({
            query: () => `SELECT * FROM test`,
            params: () => [],
            key: () => incKey,
          }),
        { wrapper },
      )

      await waitFor(() =>
        expect(result()?.rows).toEqual([
          {
            id: 1,
            name: 'test1',
          },
          {
            id: 2,
            name: 'test2',
          },
        ]),
      )

      // detect new inserts
      db.exec(`INSERT INTO test (name) VALUES ('test3');`)
      await waitFor(() =>
        expect(result()?.rows).toEqual([
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
        ]),
      )

      // detect deletes
      db.exec(`DELETE FROM test WHERE name = 'test1';`)
      await waitFor(() =>
        expect(result()?.rows).toEqual([
          {
            id: 2,
            name: 'test2',
          },
          {
            id: 3,
            name: 'test3',
          },
        ]),
      )

      // detect updates
      db.exec(`UPDATE test SET name = 'foobar' WHERE name = 'test2';`)
      await waitFor(() =>
        expect(result()?.rows).toEqual([
          {
            id: 3,
            name: 'test3',
          },
          {
            id: 2,
            name: 'foobar',
          },
        ]),
      )

      // // detect truncates
      // db.exec(`TRUNCATE test;`)
      // await waitFor(() => expect(result.current?.rows).toHaveLength(0))
    })

    it('updates when query changes', () =>
      createRoot(async () => {
        await db.exec(`INSERT INTO test (name) VALUES ('test1'),('test2');`)

        const [query, setQuery] = createSignal(`SELECT * FROM test`)
        const { result } = renderHook(
          (props: { query: Accessor<string> }) => {
            return hookFn({
              query: () => props.query(),
              params: () => [],
              key: () => incKey,
            })
          },
          { wrapper, initialProps: [{ query }] },
        )

        await waitFor(() => expect(result()?.rows).toHaveLength(2))

        setQuery(`SELECT * FROM test WHERE name = 'test1'`)

        await waitFor(() => expect(result()?.rows).toHaveLength(1))
      }))

    it('updates when query parameters change', async () => {
      await db.exec(`INSERT INTO test (name) VALUES ('test1'),('test2');`)

      const [paramsArr, setParamsArr] = createSignal(['foo'])

      const { result } = renderHook(
        (props: { params: Accessor<Array<string>> }) =>
          hookFn({
            query: () => `SELECT * FROM test WHERE name = $1;`,
            params: () => [props.params()[props.params().length - 1]],
            key: () => incKey,
          }),
        { wrapper, initialProps: [{ params: paramsArr }] },
      )

      await waitFor(() => expect(result()?.rows).toEqual([]))

      // update when query parameter changes
      setParamsArr(['test1'])

      await waitFor(() =>
        expect(result()?.rows).toEqual([
          {
            id: 1,
            name: 'test1',
          },
        ]),
      )

      // update when number of query parameters changes
      setParamsArr(['test1', 'test2'])

      await waitFor(() =>
        expect(result()?.rows).toEqual([
          {
            id: 2,
            name: 'test2',
          },
        ]),
      )
    })

    if (queryHook !== 'useLiveQuery') {
      return
    }

    it('can take a live query return value directly', async () => {
      await db.exec(`
        CREATE TABLE live_test (
          id SERIAL PRIMARY KEY,
          name TEXT
        );
      `)
      await db.exec(`INSERT INTO live_test (name) VALUES ('initial');`)

      const liveQuery = await db.live.query(
        `SELECT * FROM live_test ORDER BY id DESC LIMIT 1;`,
      )
      const { result } = renderHook(
        () => useLiveQuery({ query: () => liveQuery }),
        { wrapper },
      )

      await waitFor(() => expect(result()?.rows).toHaveLength(1))
      expect(result()?.rows[0]).toEqual({ id: 1, name: 'initial' })

      // Trigger an update
      await db.exec(`INSERT INTO live_test (name) VALUES ('updated');`)
      await waitFor(() => expect(result()?.rows[0].name).toBe('updated'))
      expect(result()?.rows[0]).toEqual({ id: 2, name: 'updated' })
    })

    it('can take a live query returned promise directly', async () => {
      await db.exec(`
        CREATE TABLE live_test (
          id SERIAL PRIMARY KEY,
          name TEXT
        );
      `)
      await db.exec(`INSERT INTO live_test (name) VALUES ('initial');`)

      const liveQueryPromise = db.live.query(
        `SELECT * FROM live_test ORDER BY id DESC LIMIT 1;`,
      )
      const { result } = renderHook(
        () => useLiveQuery({ query: () => liveQueryPromise }),
        {
          wrapper,
        },
      )

      expect(result()).toBe(undefined)

      await waitFor(() => expect(result()).not.toBe(undefined))

      await waitFor(() => expect(result()?.rows).toHaveLength(1))
      expect(result()?.rows[0]).toEqual({ id: 1, name: 'initial' })

      // Trigger an update
      await db.exec(`INSERT INTO live_test (name) VALUES ('updated');`)
      await waitFor(() => expect(result()?.rows[0].name).toBe('updated'))
      expect(result()?.rows[0]).toEqual({ id: 2, name: 'updated' })
    })

    it('can take a live incremental query return value directly', async () => {
      await db.exec(`
        CREATE TABLE live_test (
          id SERIAL PRIMARY KEY,
          name TEXT
        );
      `)
      await db.exec(`INSERT INTO live_test (name) VALUES ('initial');`)

      const liveQuery = await db.live.incrementalQuery(
        `SELECT * FROM live_test ORDER BY id DESC LIMIT 1;`,
        [],
        incKey,
      )
      const { result } = renderHook(
        () => useLiveQuery({ query: () => liveQuery }),
        { wrapper },
      )

      await waitFor(() => expect(result()?.rows).toHaveLength(1))
      expect(result()?.rows[0]).toEqual({ id: 1, name: 'initial' })

      // Trigger an update
      await db.exec(`INSERT INTO live_test (name) VALUES ('updated');`)
      await waitFor(() => expect(result()?.rows[0].name).toBe('updated'))
      expect(result()?.rows[0]).toEqual({ id: 2, name: 'updated' })
    })

    it('can take a live incremental query returned promise directly', async () => {
      await db.exec(`
        CREATE TABLE live_test (
          id SERIAL PRIMARY KEY,
          name TEXT
        );
      `)
      await db.exec(`INSERT INTO live_test (name) VALUES ('initial');`)

      const liveQueryPromise = db.live.incrementalQuery(
        `SELECT * FROM live_test ORDER BY id DESC LIMIT 1;`,
        [],
        incKey,
      )
      const { result } = renderHook(
        () => useLiveQuery({ query: () => liveQueryPromise }),
        {
          wrapper,
        },
      )

      expect(result()).toBe(undefined)

      await waitFor(() => expect(result()).not.toBe(undefined))

      await waitFor(() => expect(result()?.rows).toHaveLength(1))
      expect(result()?.rows[0]).toEqual({ id: 1, name: 'initial' })

      // Trigger an update
      await db.exec(`INSERT INTO live_test (name) VALUES ('updated');`)
      await waitFor(() => expect(result()?.rows[0].name).toBe('updated'))
    })

    it('works with pattern matching', async () => {
      await db.exec(`
        CREATE TABLE pattern_matching (
          id SERIAL PRIMARY KEY,
          statement VARCHAR(100)
        );
      `)

      await db.exec(
        `INSERT INTO pattern_matching (statement) VALUES ('PGlite 4 ever.'),('To not be or not to be.');`,
      )

      const liveQueryPromise = db.live.incrementalQuery(
        `SELECT * FROM pattern_matching WHERE statement ILIKE '%pglite%' ORDER BY id DESC LIMIT 1;`,
        [],
        incKey,
      )

      const { result } = renderHook(
        () => useLiveQuery({ query: () => liveQueryPromise }),
        {
          wrapper,
        },
      )

      await waitFor(() =>
        expect(result()?.rows).toEqual([
          {
            id: 1,
            statement: 'PGlite 4 ever.',
          },
        ]),
      )

      await db.exec(
        `INSERT INTO pattern_matching (statement) VALUES ('should not trigger!');`,
      )
      // Trigger an update
      await db.exec(
        `INSERT INTO pattern_matching (statement) VALUES ('ElectricSQL + pglite = <3');`,
      )
      await waitFor(() =>
        expect(result()?.rows[0].statement).toBe('ElectricSQL + pglite = <3'),
      )
    })
  })
}
