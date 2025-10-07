import { it, expect } from 'vitest'
import { PGlite } from '../../dist/index.js'
import { pg_walinspect } from '../../dist/contrib/pg_walinspect.js'

it('pg_walinspect', async () => {
  const pg = await PGlite.create({
    extensions: {
      pg_walinspect,
    },
  })

  await pg.exec('CREATE EXTENSION IF NOT EXISTS pg_walinspect;')

  await pg.exec(`
CREATE TABLE test_wal (
id SERIAL PRIMARY KEY,
data TEXT
);
`)

  const blsn = await pg.query(`
SELECT pg_current_wal_lsn() AS before_lsn;
`)

  await pg.exec(`
INSERT INTO test_wal(data)
SELECT 'row ' || generate_series::text
FROM generate_series(1,5);
`)

  const alsn = await pg.query(`
SELECT pg_current_wal_lsn() AS after_lsn;
`)

  const _blsn = blsn.rows[0].before_lsn
  const _alsn = alsn.rows[0].after_lsn
  const infos = await pg.query(`
SELECT * FROM pg_get_wal_block_info($1, $2)
ORDER BY start_lsn, block_id
LIMIT 200;`,
    [_blsn, _alsn],
  )

  expect(infos.rows.length).toBeGreaterThan(0)
})
