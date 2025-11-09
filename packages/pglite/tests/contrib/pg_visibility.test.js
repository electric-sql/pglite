import { it, expect } from 'vitest'
import { PGlite } from '../../dist/index.js'
import { pg_visibility } from '../../dist/contrib/pg_visibility.js'

it('pg_visibility', async () => {
  const pg = await PGlite.create({
    extensions: {
      pg_visibility,
    },
  })

  await pg.exec('CREATE EXTENSION IF NOT EXISTS pg_visibility;')

  await pg.exec(`
CREATE TABLE IF NOT EXISTS test (
id SERIAL PRIMARY KEY,
name TEXT
);
`)

  await pg.exec(`
INSERT INTO test (name) VALUES ('test');
UPDATE test SET name = 'test2';
SELECT * FROM test;
`)

  const visible = await pg.query(`
-- Show all invisible tuples in a specific table using pg_visibility
SELECT * 
FROM pg_visibility('test') 
WHERE all_visible = false;
`)

  expect(visible.rows).toEqual([
    {
      blkno: 0,
      all_visible: false,
      all_frozen: false,
      pd_all_visible: false,
    },
  ])

  const visibilityMap = await pg.query(`
-- Check visibility map status for a table
SELECT * 
FROM pg_visibility_map('test');
`)

  expect(visibilityMap.rows).toEqual([
    {
      blkno: 0,
      all_visible: false,
      all_frozen: false,
    },
  ])

  const frozen = await pg.query(`
-- Find pages with all-frozen tuples
SELECT * 
FROM pg_visibility('test')
WHERE all_frozen = true;
`)

  expect(frozen.rows).toEqual([])
})
