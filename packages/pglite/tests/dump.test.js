import { describe, it, expect } from 'vitest'
import { PGlite } from '../dist/index.js'
import * as fs from 'fs/promises'

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
    const folderPath = './pgdata-test-dump'
    await fs.rm(folderPath, { force: true, recursive: true })
    const pg1 = new PGlite(folderPath)
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

    await pg1.close()
    await pg2.close()
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

  it('dump data dir and load it - compressed but not specified', async () => {
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

    // remove the mime type from the file
    const file2 = new Blob([file])

    expect(typeof file2).toBe('object')

    const pg2 = new PGlite({
      loadDataDir: file2,
    })

    const ret2 = await pg2.query('SELECT * FROM test;')

    expect(ret1).toEqual(ret2)
  })
})
