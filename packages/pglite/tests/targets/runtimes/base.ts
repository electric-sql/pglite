import { describe, it, expect } from 'vitest'
import { PGlite } from '../../../dist/index.js'

export function tests(env, dbFilename, target) {
  describe(`targets ${target}`, () => {
    let db
    it(`basic`, async () => {
      db = new PGlite(dbFilename)

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
      await db.query('INSERT INTO test (name) VALUES ($1);', ['test2'])
      const res = await db.query(`
          SELECT * FROM test;
        `)

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
      // Force compression to test that it's working in all environments
      const file = await db.dumpDataDir('gzip')
      const db2 = await PGlite.create({
        loadDataDir: file,
      })
      const res = await db2.query('SELECT * FROM test;')

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
      // should not throw
      await db.close()
    })

    if (dbFilename === 'memory://') {
      // Skip the rest of the tests for memory:// as it's not persisted
      return
    }

    it(`persisted`, async () => {
      db = new PGlite(dbFilename)

      await db.waitReady
      const res = await db.query(`
          SELECT * FROM test;
        `)

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
  })
}
