import { describe, it, expect } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import Cursor from 'pg-cursor'
import { PGlitePgConfig } from '../dist/pglite-node-postgres.js'
import { Pool } from 'pg'

describe('node-postgres + PGlite = love', () => {
  it('query PGlite with node-postgres Pool', async () => {
    const db = await PGlite.create()

    await db.exec(`
    CREATE TABLE IF NOT EXISTS test (
      id SERIAL PRIMARY KEY,
      name TEXT
    );
  `)

    await db.exec("INSERT INTO test (name) VALUES ('test');")

    const connConfig = new PGlitePgConfig({ pglite: db })

    const pool = new Pool(connConfig)
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
      const pglite = await PGlite.create()
      const connConfig = new PGlitePgConfig({ pglite })
      const pool = new Pool(connConfig)
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
        values
      )

      const cursor = client.query(new Cursor('SELECT * FROM items;'))

      while (true) {
        const rows = await cursor.read(10)
        if (rows.length === 0) break
        expect(rows.length).toEqual(10)
      }
    })
})
