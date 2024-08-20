import { it, expect } from 'vitest'
import { PGlite } from '../../dist/index.js'
import { bloom } from '../../dist/contrib/bloom.js'

it('bloom', async () => {
  const pg = new PGlite({
    extensions: {
      bloom,
    },
  })

  await pg.exec('CREATE EXTENSION IF NOT EXISTS bloom;')

  await pg.exec(`
    CREATE TABLE IF NOT EXISTS test (
      id SERIAL PRIMARY KEY,
      name TEXT
    );
    CREATE INDEX IF NOT EXISTS test_name_bloom_idx ON test USING bloom (name);
  `)

  await pg.exec("INSERT INTO test (name) VALUES ('test1');")
  await pg.exec("INSERT INTO test (name) VALUES ('test2');")
  await pg.exec("INSERT INTO test (name) VALUES ('test3');")

  const res = await pg.query(`
    SELECT
      name
    FROM test
    WHERE name = 'test1';
  `)

  expect(res.rows).toEqual([
    {
      name: 'test1',
    },
  ])

  const res2 = await pg.query(`
    EXPLAIN ANALYZE
    SELECT
      name
    FROM test
    WHERE name = 'test1';
  `)

  // check that `test_name_bloom_idx` is in the plan
  const match = res2.rows.filter((row) =>
    row['QUERY PLAN'].includes('test_name_bloom_idx'),
  )
  expect(match.length > 0).toBe(true)
})
