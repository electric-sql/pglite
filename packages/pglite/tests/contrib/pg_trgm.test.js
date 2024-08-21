import { describe, it, expect } from 'vitest'
import { PGlite } from '../../dist/index.js'
import { pg_trgm } from '../../dist/contrib/pg_trgm.js'

describe('pg_trgm', () => {
  it('gin', async () => {
    const pg = new PGlite({
      extensions: {
        pg_trgm,
      },
    })

    await pg.exec('CREATE EXTENSION IF NOT EXISTS pg_trgm;')
    await pg.exec(`
    CREATE TABLE IF NOT EXISTS test (
      id SERIAL PRIMARY KEY,
      name TEXT
    );
    CREATE INDEX IF NOT EXISTS test_name_trgm_idx ON test USING gin (name gin_trgm_ops);
  `)
    await pg.exec("INSERT INTO test (name) VALUES ('test1');")
    await pg.exec("INSERT INTO test (name) VALUES ('test2');")
    await pg.exec("INSERT INTO test (name) VALUES ('text3');")

    const res = await pg.query(`
    SELECT
      name,
      name % 'test' AS similarity,
      name <-> 'test' AS distance
    FROM test;
  `)

    expect(res.rows).toEqual([
      {
        name: 'test1',
        similarity: true,
        distance: 0.4285714,
      },
      {
        name: 'test2',
        similarity: true,
        distance: 0.4285714,
      },
      {
        name: 'text3',
        similarity: false,
        distance: 0.7777778,
      },
    ])

    const res2 = await pg.query(`
    SELECT
      name
    FROM test
    WHERE name % 'test';
  `)

    expect(res2.rows).toEqual([
      {
        name: 'test1',
      },
      {
        name: 'test2',
      },
    ])
  })

  it('gist', async () => {
    const pg = new PGlite({
      extensions: {
        pg_trgm,
      },
    })

    await pg.exec('CREATE EXTENSION IF NOT EXISTS pg_trgm;')
    await pg.exec(`
    CREATE TABLE IF NOT EXISTS test (
      id SERIAL PRIMARY KEY,
      name TEXT
    );
    CREATE INDEX IF NOT EXISTS test_name_trgm_idx ON test USING gist (name gist_trgm_ops);
  `)
    await pg.exec("INSERT INTO test (name) VALUES ('test1');")
    await pg.exec("INSERT INTO test (name) VALUES ('test2');")
    await pg.exec("INSERT INTO test (name) VALUES ('text3');")

    const res = await pg.query(`
    SELECT
      name,
      name % 'test' AS similarity,
      name <-> 'test' AS distance
    FROM test;
  `)

    expect(res.rows).toEqual([
      {
        name: 'test1',
        similarity: true,
        distance: 0.4285714,
      },
      {
        name: 'test2',
        similarity: true,
        distance: 0.4285714,
      },
      {
        name: 'text3',
        similarity: false,
        distance: 0.7777778,
      },
    ])

    const res2 = await pg.query(`
    SELECT
      name
    FROM test
    WHERE name % 'test';
  `)

    expect(res2.rows).toEqual([
      {
        name: 'test1',
      },
      {
        name: 'test2',
      },
    ])
  })
})
