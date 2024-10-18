import { describe, it, expect } from 'vitest'
import { PGlite } from '../dist/index.js'

describe('large query', () => {
  it('8192 byte wire message', async () => {
    const pg = await PGlite.create()

    await pg.exec('CREATE TABLE test (id SERIAL PRIMARY KEY, data TEXT);')

    const value = 'a'.repeat(8150)
    const sql = `INSERT INTO test (data) VALUES ('${value}');`

    // 8192 page size, 6 bytes for the wire protocol header
    expect(sql.length).toBe(8192 - 6)

    await pg.exec(sql)

    const res = await pg.query<{ data: string }>(`
      SELECT * FROM test;
    `)

    expect(res.rows.length).toBe(1)
    expect(res.rows[0].data).toBe(value)

    pg.close()
  })

  it('8193 byte wire message', async () => {
    const pg = await PGlite.create()

    await pg.exec('CREATE TABLE test (id SERIAL PRIMARY KEY, data TEXT);')

    const value = 'a'.repeat(8151)
    const sql = `INSERT INTO test (data) VALUES ('${value}');`

    // 1 more than 8192 page size, 6 bytes for the wire protocol header
    expect(sql.length).toBe(8193 - 6)

    await pg.exec(sql)

    const res = await pg.query<{ data: string }>(`
      SELECT * FROM test;
    `)

    expect(res.rows.length).toBe(1)
    expect(res.rows[0].data).toBe(value)

    pg.close()
  })

  it('1mb value in insert and select', async () => {
    const pg = await PGlite.create()

    await pg.exec(`
      CREATE TABLE test (id SERIAL PRIMARY KEY, data TEXT);
    `)

    // 1mb value
    const value = 'a'.repeat(1_000_000)

    await pg.query('INSERT INTO test (data) VALUES ($1);', [value])

    await pg.exec(`
      INSERT INTO test (data) VALUES (${value});
    `)

    const res = await pg.query<{ data: string }>(`
      SELECT * FROM test;
    `)

    expect(res.rows.length).toBe(2)
    expect(res.rows[0].data).toBe(value)

    pg.close()

    // sleep for GC to collect
    await new Promise((resolve) => setTimeout(resolve, 100))
  })

  it('1mb of SQL in query', async () => {
    const pg = await PGlite.create()

    await pg.exec(`
      CREATE TABLE test (id SERIAL PRIMARY KEY, data TEXT);
    `)

    let sql = ''
    for (let i = 0; i < 26316; i++) {
      // 26316 * 38 = 1,000,008 bytes
      sql += `INSERT INTO test (data) VALUES ('a');\n` // 38b statement
    }

    await pg.exec(sql)

    pg.close()

    // sleep for GC to collect
    await new Promise((resolve) => setTimeout(resolve, 100))
  })

  it('select 10k rows ~ 10mb', async () => {
    const pg = await PGlite.create()

    await pg.exec(`
      CREATE TABLE test (id SERIAL PRIMARY KEY, data TEXT);
    `)

    // 1kb
    const value = 'a'.repeat(1000)

    await pg.exec(`
      INSERT INTO test (data)
      SELECT 'Row ' || generate_series || '${value}'
      FROM generate_series(1, 10000);
    `)

    const res = await pg.query<{ data: string }>(`
      SELECT * FROM test;
    `)

    expect(res.rows.length).toBe(10000)

    pg.close()

    // sleep for GC to collect
    await new Promise((resolve) => setTimeout(resolve, 100))
  })

  it('select 100k rows ~ 100mb', async () => {
    const pg = await PGlite.create()

    await pg.exec(`
      CREATE TABLE test (id SERIAL PRIMARY KEY, data TEXT);
    `)

    // 1kb
    const value = 'a'.repeat(1000)

    await pg.exec(`
      INSERT INTO test (data)
      SELECT 'Row ' || generate_series || '${value}'
      FROM generate_series(1, 100000);
    `)

    const res = await pg.query<{ data: string }>(`
      SELECT * FROM test;
    `)

    expect(res.rows.length).toBe(100000)

    pg.close()

    // sleep for GC to collect
    await new Promise((resolve) => setTimeout(resolve, 100))
  })

  it('select 1m rows ~ 1gb', async () => {
    const pg = await PGlite.create()

    await pg.exec(`
      CREATE TABLE test (id SERIAL PRIMARY KEY, data TEXT);
    `)

    // 1kb
    const value = 'a'.repeat(1000)

    // This time only select from the series, not insert into the table
    const res = await pg.query(`
      SELECT 'Row ' || generate_series || '${value}'
      FROM generate_series(1, 1000000);
    `)

    expect(res.rows.length).toBe(1000000)

    pg.close()

    // sleep for GC to collect
    await new Promise((resolve) => setTimeout(resolve, 100))
  })
})
