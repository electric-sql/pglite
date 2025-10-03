import { describe, it, expect } from 'vitest'
import { PGlite } from '../dist/index.js'

describe('clone', () => {
  it('clone pglite instance', async () => {
    const pg1 = await PGlite.create()
    await pg1.exec(`
    CREATE TABLE IF NOT EXISTS test (
      id SERIAL PRIMARY KEY,
      name TEXT
    );
  `)
    await pg1.exec("INSERT INTO test (name) VALUES ('test');")

    const pg2 = await pg1.clone()

    const ret1 = await pg1.query('SELECT * FROM test;')
    const ret2 = await pg2.query('SELECT * FROM test;')

    expect(ret1).toEqual(ret2)
  })

  it('clone pglite instance - insert into pg2', async () => {
    const pg1 = await PGlite.create()
    await pg1.exec(`
    CREATE TABLE IF NOT EXISTS test (
      id SERIAL PRIMARY KEY,
      name TEXT
    );
  `)
    await pg1.exec("INSERT INTO test (name) VALUES ('test');")

    const pg2 = await pg1.clone()
    await pg2.exec("INSERT INTO test (name) VALUES ('2-test');")

    const ret1 = await pg1.query('SELECT * FROM test;')
    const ret2 = await pg2.query('SELECT * FROM test;')

    expect(ret1.rows.length).toBe(1)
    expect(ret2.rows.length).toBe(2)
  })
})
