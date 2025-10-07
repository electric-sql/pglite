import { it } from 'vitest'
import { PGlite } from '../../dist/index.js'
import { pageinspect } from '../../dist/contrib/pageinspect.js'

it('pageinspect', async () => {
  const pg = await PGlite.create({
    extensions: {
      pageinspect,
    },
  })

  await pg.exec('CREATE EXTENSION IF NOT EXISTS pageinspect;')

  await pg.exec(`
CREATE TABLE pageinspect_test (
id serial PRIMARY KEY,
name text,
value integer);
`)

  await pg.exec(`INSERT INTO pageinspect_test (name, value)
SELECT
'row_' || g,
(random() * 100)::int
FROM generate_series(1, 5) AS g;`)

  await pg.exec('CHECKPOINT;')

  await pg.query(`
SELECT relfilenode, relname
FROM pg_class
WHERE relname = 'pageinspect_test';
`)

  await pg.query(`
SELECT *
FROM heap_page_items(get_raw_page('pageinspect_test', 0));
`)

  await pg.query(`
SELECT * FROM page_header(get_raw_page('pageinspect_test', 0));
`)

  await pg.query(`
SELECT * FROM pageinspect_test ORDER BY id;
`)
})
