import { describe, it, expect } from 'vitest'
import { testEsmAndCjs } from './test-utils.js'

await testEsmAndCjs(async (importType) => {
  const { PGlite } =
    importType === 'esm'
      ? await import('../dist/index.js')
      : await import('../dist/index.cjs')

  const { vector } =
    importType === 'esm'
      ? await import('../dist/vector/index.js')
      : await import('../dist/vector/index.cjs')

  describe(`pgvector ${importType}`, () => {
    it('basic', async () => {
      const pg = new PGlite({
        extensions: {
          vector,
        },
      })

      await pg.exec('CREATE EXTENSION IF NOT EXISTS vector;')
      await pg.exec(`
    CREATE TABLE IF NOT EXISTS test (
      id SERIAL PRIMARY KEY,
      name TEXT,
      vec vector(3)
    );
  `)
      await pg.exec("INSERT INTO test (name, vec) VALUES ('test1', '[1,2,3]');")
      await pg.exec("INSERT INTO test (name, vec) VALUES ('test2', '[4,5,6]');")
      await pg.exec("INSERT INTO test (name, vec) VALUES ('test3', '[7,8,9]');")

      const res = await pg.exec(`
    SELECT
      name,
      vec,
      vec <-> '[3,1,2]' AS distance
    FROM test;
  `)

      expect(res).toMatchObject([
        {
          rows: [
            {
              name: 'test1',
              vec: '[1,2,3]',
              distance: 2.449489742783178,
            },
            {
              name: 'test2',
              vec: '[4,5,6]',
              distance: 5.744562646538029,
            },
            {
              name: 'test3',
              vec: '[7,8,9]',
              distance: 10.677078252031311,
            },
          ],
          fields: [
            {
              name: 'name',
              dataTypeID: 25,
            },
            {
              name: 'vec',
              dataTypeID: 16385,
            },
            {
              name: 'distance',
              dataTypeID: 701,
            },
          ],
          affectedRows: 0,
        },
      ])
    })

    it('has correct oid', async () => {
      const pg = new PGlite({
        extensions: {
          vector,
        },
      })

      await pg.exec('CREATE EXTENSION IF NOT EXISTS vector;')

      const res = await pg.query(`
        select oid 
        from pg_extension
        where extname = 'vector'
      `)

      // 16384 is the first none builtin object id
      // as the vector extension is the first thing we create it should be this
      // it certainly wont be lower.
      // if it happens to be higher it may be that we have changed PGlite to create
      // something with that oid before handing back to the user, if thats the case we
      // should check what we are doing, and then update this test.
      expect(res.rows[0].oid).toBe(16384)
    })

    it('has correct oid after restart', async () => {
      let pg = await PGlite.create({
        dataDir: './pgdata-test-vector-oid',
        extensions: {
          vector,
        },
      })

      await pg.close()

      pg = await PGlite.create({
        dataDir: './pgdata-test-vector-oid',
        extensions: {
          vector,
        },
      })

      await pg.exec('CREATE EXTENSION IF NOT EXISTS vector;')

      const res = await pg.query(`
        select oid 
        from pg_extension
        where extname = 'vector'
      `)

      expect(res.rows[0].oid).toBeGreaterThanOrEqual(16384)
    })
  })
})
