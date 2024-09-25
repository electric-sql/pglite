import { describe, it, expect } from 'vitest'
import { PGlite } from '../dist/index.js'
import * as fs from 'fs/promises'

describe('drop database', () => {
  it('should drop database', async () => {
    const pg = await PGlite.create()
    await pg.exec(`
      DROP DATABASE postgres;
    `)
  })

  it('should drop postgres db and create from template1', async () => {
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
      DROP DATABASE postgres;
    `)

    await pg.exec(`
      CREATE DATABASE postgres TEMPLATE template1;
    `)

    await pg.close()

    const pg2 = await PGlite.create('./pgdata-test-drop-db', {
      database: 'postgres',
    })

    const ret = await pg2.query(`
      SELECT * FROM test;
    `)

    expect(ret.rows).toEqual([{ id: 1, name: 'test' }])
  })
})
