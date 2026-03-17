import { describe, it, expect } from 'vitest'
import { PGlite } from '../dist/index.js'
import * as fs from 'fs/promises'

describe('drop database', () => {
  it('should create and drop database', async () => {
    const pg = await PGlite.create()

    await pg.exec(`
      CREATE DATABASE mypostgres TEMPLATE template1;
    `)

    await pg.exec(`
      DROP DATABASE mypostgres;
    `)
  })

  it('should drop postgres db and create from postgres', async () => {
    await fs.rm('./pgdata-test-drop-db', { force: true, recursive: true })
    const pg = await PGlite.create('./pgdata-test-drop-db')
    await pg.exec(`
      CREATE TABLE IF NOT EXISTS test (
        id SERIAL PRIMARY KEY,
        name TEXT
      );
    `)
    await pg.exec("INSERT INTO test (name) VALUES ('test');")

    await pg.exec(`
      DROP DATABASE IF EXISTS mypostgres;
    `)

    await pg.exec(`
      CREATE DATABASE mypostgres TEMPLATE postgres;
    `)

    await pg.close()

    const pg2 = await PGlite.create('./pgdata-test-drop-db', {
      database: 'mypostgres',
    })

    const ret = await pg2.query(`
      SELECT * FROM test;
    `)

    expect(ret.rows).toEqual([{ id: 1, name: 'test' }])
  })

  it('should drop postgres db and restart after unclean shutdown', async () => {
    await fs.rm('./pgdata-test-drop-db2', { force: true, recursive: true })
    {
      let pg: PGlite | null = await PGlite.create('./pgdata-test-drop-db2')
      await pg.exec(`
        CREATE TABLE IF NOT EXISTS test (
          id SERIAL PRIMARY KEY,
          name TEXT
        );
      `)
      await pg.exec("INSERT INTO test (name) VALUES ('test');")

      await pg.exec(`
        DROP DATABASE IF EXISTS mypostgres;
      `)

      await pg.exec(`
        CREATE DATABASE mypostgres TEMPLATE template1;
      `)

      // we don't close pg here on purpose
      pg = null
    }

    // pause for a bit for GC...
    await new Promise((resolve) => setTimeout(resolve, 10))

    const pg2 = await PGlite.create('./pgdata-test-drop-db2', {
      database: 'postgres',
    })

    const ret = await pg2.query(`
      SELECT * FROM test;
    `)

    expect(ret.rows).toEqual([{ id: 1, name: 'test' }])
  })
})
