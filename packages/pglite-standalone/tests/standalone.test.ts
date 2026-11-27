import { describe, it, expect, beforeAll } from 'vitest'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { Parser, serialize } from '@electric-sql/pg-protocol'
import type { BackendMessage } from '@electric-sql/pg-protocol/messages'
import { StandalonePGlite, initdb, loadModule } from '../src/index.js'
import { commandArgs } from '../src/initdb.js'

const RELEASE = new URL('../release/', import.meta.url)
const WASM = new URL('pglite-standalone.wasm', RELEASE)
const INITDB_WASM = new URL('initdb-standalone.wasm', RELEASE)
const FS = new URL('pglite-standalone-fs.tar.gz', RELEASE)

interface Result {
  rows: (string | null)[][]
  error?: { code: string; message: string }
  status: string
}

/** Run a simple query and collect the parts of the response we check */
function query(pg: StandalonePGlite, sql: string): Result {
  const result: Result = { rows: [], status: '' }
  new Parser().parse(
    pg.execProtocolRaw(serialize.query(sql)),
    (msg: BackendMessage) => {
      if (msg.name === 'dataRow') result.rows.push((msg as any).fields)
      if (msg.name === 'error') {
        result.error = {
          code: (msg as any).code,
          message: (msg as any).message,
        }
      }
      if (msg.name === 'readyForQuery') result.status = (msg as any).status
    },
  )
  return result
}

/** The imports other than WASI: what every host has to provide */
function hostImports(module: WebAssembly.Module): string[] {
  return WebAssembly.Module.imports(module)
    .filter((i) => i.module !== 'wasi_snapshot_preview1')
    .map((i) => `${i.module}.${i.name}`)
    .sort()
}

describe('commandArgs', () => {
  it('splits the commands initdb runs', () => {
    expect(
      commandArgs(
        `"/pglite/bin/postgres" --boot -X 1048576 -c 'a b' -c "x=\\"y\\"" 2>&1 >/dev/null`,
      ),
    ).toEqual([
      '/pglite/bin/postgres',
      '--boot',
      '-X',
      '1048576',
      '-c',
      'a b',
      '-c',
      'x="y"',
    ])
  })
})

describe.skipIf(!existsSync(WASM))('standalone module', () => {
  let module: WebAssembly.Module
  let initdbModule: WebAssembly.Module
  let fs: Uint8Array
  let dataDir: Uint8Array

  beforeAll(async () => {
    module = await loadModule(WASM.pathname)
    initdbModule = await loadModule(INITDB_WASM.pathname)
    fs = await readFile(FS)
    dataDir = initdb({ initdbModule, postgresModule: module, fs: [fs] })
  })

  // Catches toolchain or source changes that silently add an import that
  // non-JS hosts don't provide (e.g. a libc function emscripten implements
  // in JS). Update the host interface in README.md along with this.
  it('imports only WASI and the documented host functions', () => {
    const expected = [
      'env.emscripten_notify_memory_growth',
      'pglite.exec',
      'pglite.read',
      'pglite.write',
    ]
    expect(hostImports(module)).toEqual(expected)
    expect(hostImports(initdbModule)).toEqual(expected)
  })

  async function start(data = dataDir) {
    const pg = await StandalonePGlite.create({
      module,
      fs: [fs],
      dataDir: data,
    })
    const messages: string[] = []
    new Parser().parse(
      pg.execProtocolRaw(
        serialize.startup({ user: 'postgres', database: 'postgres' }),
      ),
      (msg: BackendMessage) => messages.push(msg.name),
    )
    expect(messages).toContain('authenticationOk')
    expect(messages.at(-1)).toBe('readyForQuery')
    return pg
  }

  it('runs a query', async () => {
    const pg = await start()
    expect(query(pg, 'SELECT 1')).toEqual({ rows: [['1']], status: 'I' })
    expect(query(pg, 'SELECT version()').rows[0][0]).toMatch(
      /^PostgreSQL \d+\.\d+/,
    )
  })

  it('starts from a data dir created by initdb-standalone.wasm', async () => {
    const pg = await start()
    expect(
      query(pg, `SELECT datname FROM pg_database ORDER BY datname`).rows,
    ).toEqual([['postgres'], ['template0'], ['template1']])
    // initdb ran pg_import_system_collations(), i.e. `locale -a` through pglite.exec
    expect(
      query(
        pg,
        `SELECT count(*) > 0 FROM pg_collation WHERE collprovider = 'c'`,
      ).rows,
    ).toEqual([['t']])
  })

  it('loads the extensions linked into the module', async () => {
    const pg = await start()
    for (const ext of ['ltree', 'btree_gist', 'pgtap']) {
      expect(query(pg, `CREATE EXTENSION ${ext}`).error).toBeUndefined()
    }
    expect(query(pg, `SELECT subpath('a.b.c'::ltree, 1)`).rows).toEqual([
      ['b.c'],
    ])
  })

  it('reads a data dir created by the JS build', async () => {
    // the only test that needs the regular build
    const { PGlite } = await import('@electric-sql/pglite')
    const js = await PGlite.create()
    await js.exec(`CREATE TABLE from_js (id int, name text);
                   INSERT INTO from_js VALUES (1, 'created by the JS build');`)
    const jsDataDir = new Uint8Array(
      await (await js.dumpDataDir('none')).arrayBuffer(),
    )
    await js.close()
    const pg = await start(jsDataDir)
    expect(query(pg, 'SELECT * FROM from_js').rows).toEqual([
      ['1', 'created by the JS build'],
    ])
  })

  it('recovers from errors', async () => {
    const pg = await start()
    const err = query(pg, 'SELECT 1/0')
    expect(err.error).toEqual({ code: '22012', message: 'division by zero' })
    expect(err.status).toBe('I')
    expect(query(pg, 'SELECT 2').rows).toEqual([['2']])
  })

  it('recovers from errors in functions and subtransactions', async () => {
    const pg = await start()
    query(
      pg,
      `CREATE FUNCTION div(a int, b int) RETURNS int LANGUAGE sql AS 'SELECT a / b'`,
    )
    query(pg, 'CREATE TABLE s (x int)')
    query(pg, 'BEGIN')
    query(pg, 'INSERT INTO s VALUES (1)')
    query(pg, 'SAVEPOINT sp')
    const err = query(pg, 'INSERT INTO s VALUES (div(1, 0))')
    expect(err.error?.code).toBe('22012')
    expect(err.status).toBe('E')
    expect(query(pg, 'ROLLBACK TO SAVEPOINT sp').status).toBe('T')
    query(pg, 'INSERT INTO s VALUES (div(4, 2))')
    expect(query(pg, 'COMMIT').status).toBe('I')
    expect(query(pg, 'SELECT x FROM s ORDER BY x').rows).toEqual([['1'], ['2']])
  })

  it('keeps transaction semantics across errors', async () => {
    const pg = await start()
    query(pg, 'CREATE TABLE t (id serial primary key, name text)')
    expect(query(pg, 'BEGIN').status).toBe('T')
    query(pg, `INSERT INTO t (name) VALUES ('rolled back')`)
    expect(query(pg, 'SELECT nope').status).toBe('E')
    expect(query(pg, 'SELECT 1').error?.code).toBe('25P02')
    expect(query(pg, 'ROLLBACK').status).toBe('I')
    query(pg, `INSERT INTO t (name) VALUES ('kept')`)
    expect(query(pg, 'SELECT id, name FROM t').rows).toEqual([['2', 'kept']])
  })

  it('handles multiple statements in one message', async () => {
    const pg = await start()
    const res = query(pg, 'SELECT 1; SELECT 1/0; SELECT 3')
    expect(res.rows).toEqual([['1']])
    expect(res.error?.code).toBe('22012')
    expect(res.status).toBe('I')
  })

  it('runs isolated instances side by side', async () => {
    const a = await start()
    const b = await start()
    query(a, 'CREATE TABLE only_in_a (x int)')
    expect(query(b, 'SELECT * FROM only_in_a').error?.code).toBe('42P01')
    expect(query(a, 'SELECT count(*) FROM only_in_a').rows).toEqual([['0']])
  })
})
