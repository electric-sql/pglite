import { expect, it } from 'vitest'
import { PGlite } from '../../dist/index.js'
import { pg_freespacemap } from '../../dist/contrib/pg_freespacemap.js'

it('pg_freespacemap', async () => {
  const pg = await PGlite.create({
    extensions: {
      pg_freespacemap,
    },
  })

  await pg.exec('CREATE EXTENSION IF NOT EXISTS pg_freespacemap;')

  await pg.exec(`
CREATE TABLE test_fsm(id serial PRIMARY KEY, data text);
INSERT INTO test_fsm (data) SELECT repeat('x', 100) FROM generate_series(1, 1000);
DELETE FROM test_fsm WHERE id <= 500;
`)

  const freeSpace = await pg.query(`
SELECT * FROM pg_freespace('test_fsm');
`)

  expect(freeSpace.rows.length).toBeGreaterThan(0)

  const freeSpace0 = await pg.query(`
SELECT pg_freespace('test_fsm', 0);
    `)

  expect(freeSpace0.rows.length).toBeGreaterThan(0)
})
