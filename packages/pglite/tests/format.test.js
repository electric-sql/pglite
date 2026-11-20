import { describe, beforeAll, it, expect } from 'vitest'
import { PGlite, formatQuery } from '../dist/index.js'

describe('format', () => {
  let pg
  beforeAll(async () => {
    pg = await PGlite.create()
  })

  it('boolean', async () => {
    await pg.exec(`
      CREATE TABLE test1 (
        id SERIAL PRIMARY KEY,
        value BOOLEAN
      );
    `)
    const ret1 = await formatQuery(
      pg,
      'SELECT * FROM test1 WHERE value = $1;',
      [true],
    )
    expect(ret1).toBe("SELECT * FROM test1 WHERE value = 't';")
  })

  it('number', async () => {
    await pg.exec(`
      CREATE TABLE test2 (
        id SERIAL PRIMARY KEY,
        value INTEGER
      );
    `)
    const ret2 = await formatQuery(
      pg,
      'SELECT * FROM test2 WHERE value = $1;',
      [1],
    )
    expect(ret2).toBe("SELECT * FROM test2 WHERE value = '1';")
  })

  it('string', async () => {
    await pg.exec(`
      CREATE TABLE test3 (
        id SERIAL PRIMARY KEY,
        value VARCHAR
      );
    `)
    const ret3 = await formatQuery(
      pg,
      'SELECT * FROM test3 WHERE value = $1;',
      ['test'],
    )
    expect(ret3).toBe("SELECT * FROM test3 WHERE value = 'test';")
  })

  it('params out of textual order', async () => {
    await pg.exec(`
      CREATE TABLE test5 (
        id SERIAL PRIMARY KEY,
        value VARCHAR
      );
    `)
    const ret5 = await formatQuery(
      pg,
      'SELECT * FROM test5 WHERE value = $2 AND id = $1;',
      [1, 'test'],
    )
    expect(ret5).toBe("SELECT * FROM test5 WHERE value = 'test' AND id = '1';")
  })

  it('repeated param', async () => {
    await pg.exec(`
      CREATE TABLE test6 (
        id SERIAL PRIMARY KEY,
        value VARCHAR
      );
    `)
    const ret6 = await formatQuery(
      pg,
      'SELECT * FROM test6 WHERE value = $1 OR value = $1;',
      ['test'],
    )
    expect(ret6).toBe(
      "SELECT * FROM test6 WHERE value = 'test' OR value = 'test';",
    )
  })

  it('literal percent signs alongside params', async () => {
    await pg.exec(`
      CREATE TABLE test7 (
        id SERIAL PRIMARY KEY,
        value VARCHAR
      );
    `)
    const ret7 = await formatQuery(
      pg,
      "SELECT * FROM test7 WHERE value LIKE $1 || '%' AND value <> '100%';",
      ['te'],
    )
    expect(ret7).toBe(
      "SELECT * FROM test7 WHERE value LIKE 'te' || '%' AND value <> '100%';",
    )
  })

  it('does not treat literal text as format() specifiers', async () => {
    await pg.exec(`
      CREATE TABLE test8 (
        id SERIAL PRIMARY KEY,
        value VARCHAR
      );
    `)
    const ret8 = await formatQuery(
      pg,
      "SELECT 'a%sb' AS label, '%1$I' AS label2, * FROM test8 WHERE id = $1;",
      [1],
    )
    expect(ret8).toBe(
      "SELECT 'a%sb' AS label, '%1$I' AS label2, * FROM test8 WHERE id = '1';",
    )
  })

  it('json', async () => {
    await pg.exec(`
      CREATE TABLE test4 (
        id SERIAL PRIMARY KEY,
        value JSONB
      );
    `)
    const ret4 = await formatQuery(
      pg,
      'SELECT * FROM test4 WHERE value = $1;',
      [{ test: 'test' }],
    )
    expect(ret4).toBe('SELECT * FROM test4 WHERE value = \'{"test": "test"}\';')
  })
})
