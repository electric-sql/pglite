import { describe, it, expect } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { initdb } from '../dist/initdb.js'

describe('initdb', () => {
  it('should init a database', async () => {
    const pg = await PGlite.create()
    let result = await initdb({ pg, args: ["--no-clean"] })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).contains('You can now start the database server using')
  })
  it('should init a database and exec a simple query', async () => {
    const pg = await PGlite.create()
    let result = await initdb({ pg, args: ["--no-clean"], debug: 5 })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).contains('You can now start the database server using')
    pg.startInSingle()
    const selectResult = await pg.exec('SELECT 1')
    console.log(selectResult)
  })

  it('should init a database and run simple query', async () => {
    const pg = await PGlite.create()
    let result = await initdb({ pg, args: ["--no-clean"], debug: 5 })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).contains('You can now start the database server using')
    pg.startInSingle()
    const selectResult = await pg.query('SELECT 1;')
    console.log(selectResult)
  })

  it('should init a database and create a table query', async () => {
    const pg = await PGlite.create()
    let result = await initdb({ pg, args: ["--no-clean"], debug: 5 })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).contains('You can now start the database server using')
    pg.startInSingle()
    const selectResult = await pg.query(`CREATE TABLE IF NOT EXISTS test (
        id SERIAL PRIMARY KEY,
        name TEXT);
      `)

    const multiStatementResult = await pg.exec(`
      INSERT INTO test (name) VALUES ('test');
      UPDATE test SET name = 'test2';
      SELECT * FROM test;
    `)

      expect(multiStatementResult).toEqual([
        {
          affectedRows: 1,
          rows: [],
          fields: [],
        },
        {
          affectedRows: 2,
          rows: [],
          fields: [],
        },
        {
          rows: [{ id: 1, name: 'test2' }],
          fields: [
            { name: 'id', dataTypeID: 23 },
            { name: 'name', dataTypeID: 25 },
          ],
          affectedRows: 2,
        },
      ])

    await pg.close()
    // console.log(selectResult)
  })

})
