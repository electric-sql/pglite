import { describe, it, expect } from 'vitest'
import { PGlite } from '../dist/index.js'

const bytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef])

describe('domain types', () => {
  it('serializes a bytea domain created after init', async () => {
    const db = new PGlite()
    await db.exec(`
      CREATE DOMAIN blob AS bytea;
      CREATE TABLE b (id int PRIMARY KEY, v blob);
    `)

    await db.query('INSERT INTO b VALUES ($1, $2)', [1, bytes])
    await db.query('INSERT INTO b VALUES ($1, $2)', [2, Buffer.from(bytes)])
    await db.query('INSERT INTO b VALUES ($1, $2)', [
      3,
      Buffer.from([0x00, 0x5c, 0xff, 0x80]),
    ])

    const res = await db.query<{ v: string }>(
      'SELECT v::text AS v FROM b ORDER BY id',
    )
    expect(res.rows).toEqual([
      { v: '\\xdeadbeef' },
      { v: '\\xdeadbeef' },
      { v: '\\x005cff80' },
    ])
  })

  it('serializes other domains created after init', async () => {
    const db = new PGlite()
    await db.exec(`
      CREATE DOMAIN doc AS jsonb;
      CREATE DOMAIN day AS date;
      CREATE TABLE t (d doc, dd day);
    `)

    await db.query('INSERT INTO t VALUES ($1, $2)', [
      { a: 1 },
      new Date('2026-11-27T00:00:00Z'),
    ])

    const res = await db.query<{ d: string; dd: string }>(
      'SELECT d::text AS d, dd::text AS dd FROM t',
    )
    expect(res.rows).toEqual([{ d: '{"a": 1}', dd: '2026-11-27' }])
  })

  it('follows a domain over a domain', async () => {
    const db = new PGlite()
    await db.exec(`
      CREATE DOMAIN blob AS bytea;
      CREATE DOMAIN blob2 AS blob;
      CREATE TABLE t (v blob2);
    `)

    await db.query('INSERT INTO t VALUES ($1)', [bytes])

    const res = await db.query<{ v: string }>('SELECT v::text AS v FROM t')
    expect(res.rows).toEqual([{ v: '\\xdeadbeef' }])
  })

  it('serializes arrays of a domain, with and without refreshArrayTypes', async () => {
    const db = new PGlite()
    await db.exec(`
      CREATE DOMAIN blob AS bytea;
      CREATE TABLE t (a blob[]);
    `)

    await db.query('INSERT INTO t VALUES ($1)', [[bytes, bytes]])
    await db.refreshArrayTypes()
    await db.query('INSERT INTO t VALUES ($1)', [[bytes]])

    const res = await db.query<{ a: string }>('SELECT a::text AS a FROM t')
    expect(res.rows).toEqual([
      { a: '{"\\\\xdeadbeef","\\\\xdeadbeef"}' },
      { a: '{"\\\\xdeadbeef"}' },
    ])
  })

  it('sends strings to a domain as is', async () => {
    const db = new PGlite()
    await db.exec(`
      CREATE DOMAIN blob AS bytea;
      CREATE TABLE t (v blob);
    `)

    await db.query('INSERT INTO t VALUES ($1)', ['\\xdead'])
    await db.refreshArrayTypes()
    await db.query('INSERT INTO t VALUES ($1)', ['\\xbeef'])

    const res = await db.query<{ v: string }>('SELECT v::text AS v FROM t')
    expect(res.rows).toEqual([{ v: '\\xdead' }, { v: '\\xbeef' }])
  })

  it('works inside a transaction', async () => {
    const db = new PGlite()
    await db.exec('CREATE TABLE t (v bytea)')

    await db.transaction(async (tx) => {
      await tx.exec('CREATE DOMAIN blob AS bytea')
      await tx.query('INSERT INTO t VALUES ($1::blob)', [bytes])
    })

    const res = await db.query<{ v: string }>('SELECT v::text AS v FROM t')
    expect(res.rows).toEqual([{ v: '\\xdeadbeef' }])
  })

  it('keeps types without a serializer working', async () => {
    const db = new PGlite()
    await db.exec(`
      CREATE TYPE mood AS ENUM ('sad', 'happy');
      CREATE DOMAIN good_mood AS mood;
      CREATE TABLE t (m mood, g good_mood, n int);
    `)

    await db.query('INSERT INTO t VALUES ($1, $2, $3)', ['sad', 'happy', 1])
    await db.query('INSERT INTO t VALUES ($1, $2, $3)', ['happy', 'happy', 2])

    const res = await db.query<{ m: string; g: string }>(
      'SELECT m, g FROM t ORDER BY n',
    )
    expect(res.rows).toEqual([
      { m: 'sad', g: 'happy' },
      { m: 'happy', g: 'happy' },
    ])
  })

  it('maps domains that exist when the database is opened', async () => {
    const db = new PGlite()
    await db.exec(`
      CREATE DOMAIN doc AS jsonb;
      CREATE TABLE t (d doc);
    `)
    const dump = await db.dumpDataDir('none')
    await db.close()

    const db2 = new PGlite({ loadDataDir: dump })
    await db2.query('INSERT INTO t VALUES ($1)', [{ a: 1 }])

    const res = await db2.query<{ d: string }>('SELECT d::text AS d FROM t')
    expect(res.rows).toEqual([{ d: '{"a": 1}' }])
  })
})
