import { describe, it, expect } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import Cursor from 'pg-cursor'
import { Pool } from 'pg'

describe('node-postgres + PGlite = 🔥', () => {
  it('query PGlite with node-postgres reuse connection', async () => {
    const pgConfig = await PGlite.createPgConfig()
    const pool = new Pool(pgConfig)
    const conn = await pool.connect()

    await conn.query(`
    CREATE TABLE IF NOT EXISTS test (
      id SERIAL PRIMARY KEY,
      name TEXT
    );
  `)

    await conn.query("INSERT INTO test (name) VALUES ('test');")

    for (let i = 0; i < 10; i++) {
      const res1 = await conn.query('SELECT * from test')

      expect(res1.fields).toEqual([
        {
          name: 'id',
          tableID: 16385,
          columnID: 1,
          dataTypeID: 23,
          dataTypeSize: 4,
          dataTypeModifier: -1,
          format: 0,
        },
        {
          name: 'name',
          tableID: 16385,
          columnID: 2,
          dataTypeID: 25,
          dataTypeSize: -1,
          dataTypeModifier: -1,
          format: 0,
        },
      ])

      expect(res1.rows).toEqual([
        {
          id: 1,
          name: 'test',
        },
      ])
    }
  }),
    it('query PGlite with node-postgres using Pool', async () => {
      const pgConfig = await PGlite.createPgConfig()
      const pool = new Pool(pgConfig)

      await pool.query(`
    CREATE TABLE IF NOT EXISTS test (
      id SERIAL PRIMARY KEY,
      name TEXT
    );
  `)

      await pool.query("INSERT INTO test (name) VALUES ('test');")

      for (let i = 0; i < 10; i++) {
        const res1 = await pool.query('SELECT * from test')

        expect(res1.fields).toEqual([
          {
            name: 'id',
            tableID: 16385,
            columnID: 1,
            dataTypeID: 23,
            dataTypeSize: 4,
            dataTypeModifier: -1,
            format: 0,
          },
          {
            name: 'name',
            tableID: 16385,
            columnID: 2,
            dataTypeID: 25,
            dataTypeSize: -1,
            dataTypeModifier: -1,
            format: 0,
          },
        ])

        expect(res1.rows).toEqual([
          {
            id: 1,
            name: 'test',
          },
        ])
      }
    }),
    it('query PGlite with node-postgres pg-cursor', async () => {
      const pgConfig = await PGlite.createPgConfig()
      const pool = new Pool(pgConfig)
      const client = await pool.connect()

      await client.query(`SELECT version();`)

      await client.query(`
      CREATE TABLE IF NOT EXISTS items (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL
      );
    `)

      const values = new Array<string>()
      const params = new Array<string>()
      for (let i = 1; i <= 100; i++) {
        params.push(`($${i})`)
        values.push(`item-${i}`)
      }

      await client.query(
        `INSERT INTO items (name) VALUES ${params.join(', ')};`,
        values,
      )

      const cursor = client.query(new Cursor('SELECT * FROM items;'))

      while (true) {
        const rows = await cursor.read(10)
        if (rows.length === 0) break
        expect(rows.length).toEqual(10)
      }
    })

  it('recovers from query errors', async () => {
    const pgConfig = await PGlite.createPgConfig()
    const pool = new Pool(pgConfig)
    const client = await pool.connect()

    // simple query protocol
    await expect(client.query('SELECT * FROM nope')).rejects.toMatchObject({
      code: '42P01',
    })
    expect((await client.query('SELECT 1 AS x')).rows).toEqual([{ x: 1 }])

    // extended query protocol: the server skips messages until Sync
    await expect(
      client.query('SELECT * FROM nope WHERE id = $1', [1]),
    ).rejects.toMatchObject({ code: '42P01' })
    expect((await client.query('SELECT $1::int AS x', [2])).rows).toEqual([
      { x: 2 },
    ])

    // aborted transaction
    await client.query('BEGIN')
    await expect(client.query('SELECT 1/0')).rejects.toMatchObject({
      code: '22012',
    })
    await expect(client.query('SELECT 1')).rejects.toMatchObject({
      code: '25P02',
    })
    await client.query('ROLLBACK')
    expect((await client.query('SELECT 3 AS x')).rows).toEqual([{ x: 3 }])

    client.release()

    // a failed pool.query must not break the pool
    await expect(pool.query('SELECT 1/0')).rejects.toMatchObject({
      code: '22012',
    })
    expect((await pool.query('SELECT 4 AS x')).rows).toEqual([{ x: 4 }])
  })
})
