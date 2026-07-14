import { fork, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, it, expect, afterAll } from 'vitest'
import { PGlite } from '../dist/index.js'
import * as fs from 'fs/promises'

describe('drop database', () => {
  afterAll(async () => {
    await fs.rm('./pgdata-test-drop-db', { force: true, recursive: true })
    await fs.rm('./pgdata-test-drop-db2', { force: true, recursive: true })
    await fs.rm('./.pgdata-test-drop-db.pglite.lock', { force: true })
    await fs.rm('./.pgdata-test-drop-db2.pglite.lock', { force: true })
  })

  it('should create and drop database', async () => {
    const pg = await PGlite.create()

    await pg.exec(`
      CREATE DATABASE mypostgres TEMPLATE template1;
    `)

    await pg.exec(`
      DROP DATABASE mypostgres;
    `)
    await pg.close()
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
    await pg2.close()
  })

  it('should drop postgres db and restart after unclean shutdown', async () => {
    await fs.rm('./pgdata-test-drop-db2', { force: true, recursive: true })
    const child = fork(
      fileURLToPath(
        new URL('./fixtures/drop-database-unclean-holder.mjs', import.meta.url),
      ),
      ['./pgdata-test-drop-db2'],
      { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] },
    )
    await waitForChildMessage(child, 'ready')
    child.kill('SIGKILL')
    await waitForExit(child)

    const pg2 = await PGlite.create('./pgdata-test-drop-db2', {
      database: 'postgres',
    })

    const ret = await pg2.query(`
      SELECT * FROM test;
    `)

    expect(ret.rows).toEqual([{ id: 1, name: 'test' }])
    await pg2.close()
  })
})

function waitForChildMessage(child: ChildProcess, expected: string) {
  return new Promise<void>((resolvePromise, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      reject(new Error(`unclean holder exited early (${code ?? signal})`))
    })
    child.on('message', (message) => {
      if (message === expected) resolvePromise()
    })
  })
}

function waitForExit(child: ChildProcess) {
  return new Promise<void>((resolvePromise, reject) => {
    child.once('error', reject)
    child.once('exit', () => resolvePromise())
  })
}
