import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { waitFor } from '@testing-library/dom'
import React from 'react'
import { PGlite } from '@electric-sql/pglite'
import { live, PGliteWithLive } from '@electric-sql/pglite/live'
import { PGliteProvider, useLiveQuery, useLiveIncrementalQuery } from '../src'

describe('hooks', () => {
  testLiveQuery('useLiveQuery')

  testLiveQuery('useLiveIncrementalQuery')

  describe('useLiveQuery.sql', () => {
    let db: PGliteWithLive
    let wrapper: ({
      children,
    }: {
      children: React.ReactNode
    }) => React.ReactElement

    beforeEach(async () => {
      db = await PGlite.create({
        extensions: {
          live,
        },
      })
      wrapper = ({ children }) => {
        return <PGliteProvider db={db}>{children}</PGliteProvider>
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

      const { result, rerender } = renderHook(
        (props) =>
          useLiveQuery.sql`SELECT * FROM test WHERE name = ${props.params[0]};`,
        { wrapper, initialProps: { params: ['test1'] } },
      )

      await waitFor(() =>
        expect(result.current?.rows).toEqual([
          {
            id: 1,
            name: 'test1',
          },
        ]),
      )

      rerender({ params: ['test2'] })

      await waitFor(() =>
        expect(result.current?.rows).toEqual([
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
    let wrapper: ({
      children,
    }: {
      children: React.ReactNode
    }) => React.ReactElement
    const hookFn =
      queryHook === 'useLiveQuery' ? useLiveQuery : useLiveIncrementalQuery
    const incKey = 'id'
    beforeEach(async () => {
      db = await PGlite.create({
        extensions: {
          live,
        },
      })
      wrapper = ({ children }) => {
        return <PGliteProvider db={db}>{children}</PGliteProvider>
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
        () => hookFn(`SELECT * FROM test`, [], incKey),
        { wrapper },
      )

      await waitFor(() => expect(result.current).not.toBe(undefined))
      expect(result.current).toEqual({
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
        () => hookFn(`SELECT * FROM test`, [], incKey),
        { wrapper },
      )

      await waitFor(() =>
        expect(result.current?.rows).toEqual([
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
        expect(result.current?.rows).toEqual([
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
        expect(result.current?.rows).toEqual([
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
        expect(result.current?.rows).toEqual([
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

    it('updates when query changes', async () => {
      await db.exec(`INSERT INTO test (name) VALUES ('test1'),('test2');`)

      const { result, rerender } = renderHook(
        (props) => hookFn(props.query, [], incKey),
        { wrapper, initialProps: { query: `SELECT * FROM test` } },
      )

      await waitFor(() => expect(result.current?.rows).toHaveLength(2))

      rerender({ query: `SELECT * FROM test WHERE name = 'test1'` })

      await waitFor(() => expect(result.current?.rows).toHaveLength(1))
    })

    it('updates when query parameters change', async () => {
      await db.exec(`INSERT INTO test (name) VALUES ('test1'),('test2');`)

      const paramsArr = ['foo']

      const { result, rerender } = renderHook(
        ({ params }) =>
          hookFn(
            `SELECT * FROM test WHERE name = $1;`,
            [params[params.length - 1]],
            incKey,
          ),
        { wrapper, initialProps: { params: paramsArr } },
      )

      await waitFor(() => expect(result.current?.rows).toEqual([]))

      // update when query parameter changes
      rerender({ params: ['test1'] })

      await waitFor(() =>
        expect(result.current?.rows).toEqual([
          {
            id: 1,
            name: 'test1',
          },
        ]),
      )

      // update when number of query parameters changes
      rerender({ params: ['test1', 'test2'] })

      await waitFor(() =>
        expect(result.current?.rows).toEqual([
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
      const { result } = renderHook(() => useLiveQuery(liveQuery), { wrapper })

      await waitFor(() => expect(result.current?.rows).toHaveLength(1))
      expect(result.current?.rows[0]).toEqual({ id: 1, name: 'initial' })

      // Trigger an update
      await db.exec(`INSERT INTO live_test (name) VALUES ('updated');`)
      await waitFor(() => expect(result.current?.rows[0].name).toBe('updated'))
      expect(result.current?.rows[0]).toEqual({ id: 2, name: 'updated' })
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
      const { result } = renderHook(() => useLiveQuery(liveQueryPromise), {
        wrapper,
      })

      expect(result.current).toBe(undefined)

      await waitFor(() => expect(result.current).not.toBe(undefined))

      await waitFor(() => expect(result.current?.rows).toHaveLength(1))
      expect(result.current?.rows[0]).toEqual({ id: 1, name: 'initial' })

      // Trigger an update
      await db.exec(`INSERT INTO live_test (name) VALUES ('updated');`)
      await waitFor(() => expect(result.current?.rows[0].name).toBe('updated'))
      expect(result.current?.rows[0]).toEqual({ id: 2, name: 'updated' })
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
      const { result } = renderHook(() => useLiveQuery(liveQuery), { wrapper })

      await waitFor(() => expect(result.current?.rows).toHaveLength(1))
      expect(result.current?.rows[0]).toEqual({ id: 1, name: 'initial' })

      // Trigger an update
      await db.exec(`INSERT INTO live_test (name) VALUES ('updated');`)
      await waitFor(() => expect(result.current?.rows[0].name).toBe('updated'))
      expect(result.current?.rows[0]).toEqual({ id: 2, name: 'updated' })
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
      const { result } = renderHook(() => useLiveQuery(liveQueryPromise), {
        wrapper,
      })

      expect(result.current).toBe(undefined)

      await waitFor(() => expect(result.current).not.toBe(undefined))

      await waitFor(() => expect(result.current?.rows).toHaveLength(1))
      expect(result.current?.rows[0]).toEqual({ id: 1, name: 'initial' })

      // Trigger an update
      await db.exec(`INSERT INTO live_test (name) VALUES ('updated');`)
      await waitFor(() => expect(result.current?.rows[0].name).toBe('updated'))
    })
  })
}
