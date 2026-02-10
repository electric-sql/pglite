import { tests } from './base.js'
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import * as fs from 'fs/promises'
import { PGlite } from '../../../dist/index.js'

tests('node', './pgdata-test', 'node.fs')

describe('NODEFS', () => {
  const folderPath = './pgdata-persisted'
  beforeEach(async () => {
      await fs.rm(folderPath, { force: true, recursive: true })
  })
  afterAll(async () => {
      await fs.rm(folderPath, { force: true, recursive: true })    
  })
  it('reuse persisted folder', async () => {

    await fs.rm(folderPath, { force: true, recursive: true })
    const pg1 = new PGlite(folderPath)
    await pg1.exec(`
    CREATE TABLE IF NOT EXISTS test (
      id SERIAL PRIMARY KEY,
      name TEXT
    );`)
    pg1.exec("INSERT INTO test (name) VALUES ('test');")

    const ret1 = await pg1.query('SELECT * FROM test;')

    // emscripten NODEFS peculiarities: need to close everything to flush to disk
    await pg1.close()

    // now reusing the same folder should work!
    const pg2 = new PGlite(folderPath)
    const ret2 = await pg2.query('SELECT * FROM test;')
    expect(ret1).toEqual(ret2)
    await pg2.close()
    await fs.rm(folderPath, { force: true, recursive: true })
  })
})