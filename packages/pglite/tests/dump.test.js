import { describe, it, expect } from 'vitest'
import { PGlite } from '../dist/index.js'

describe('dump', () => {
  it('dump data dir and load it', async () => {
    const pg1 = new PGlite()
    await pg1.exec(`
    CREATE TABLE IF NOT EXISTS test (
      id SERIAL PRIMARY KEY,
      name TEXT
    );
  `)
    pg1.exec("INSERT INTO test (name) VALUES ('test');")

    const ret1 = await pg1.query('SELECT * FROM test;')

    const file = await pg1.dumpDataDir()

    expect(typeof file).toBe('object')

    const pg2 = new PGlite({
      loadDataDir: file,
    })

    const ret2 = await pg2.query('SELECT * FROM test;')

    expect(ret1).toEqual(ret2)
  })

  it('dump persisted data dir and load it', async () => {
    const pg1 = new PGlite('./pgdata-test-dump')
    await pg1.exec(`
    CREATE TABLE IF NOT EXISTS test (
      id SERIAL PRIMARY KEY,
      name TEXT
    );
  `)
    pg1.exec("INSERT INTO test (name) VALUES ('test');")

    const ret1 = await pg1.query('SELECT * FROM test;')

    const file = await pg1.dumpDataDir()

    expect(typeof file).toBe('object')

    const pg2 = new PGlite({
      loadDataDir: file,
    })

    const ret2 = await pg2.query('SELECT * FROM test;')

    expect(ret1).toEqual(ret2)
  })

  it('dump data dir and load it no compression', async () => {
    const pg1 = new PGlite()
    await pg1.exec(`
    CREATE TABLE IF NOT EXISTS test (
      id SERIAL PRIMARY KEY,
      name TEXT
    );
  `)
    pg1.exec("INSERT INTO test (name) VALUES ('test');")

    const ret1 = await pg1.query('SELECT * FROM test;')

    const file = await pg1.dumpDataDir('none')

    expect(typeof file).toBe('object')

    expect(file.type).toBe('application/x-tar')

    const pg2 = new PGlite({
      loadDataDir: file,
    })

    const ret2 = await pg2.query('SELECT * FROM test;')

    expect(ret1).toEqual(ret2)
  })
})
