import { expect, it } from 'vitest'
import { PGlite } from '../../dist/index.js'
import { pg_buffercache } from '../../dist/contrib/pg_buffercache.js'

it('pg_buffercache', async () => {
  const pg = await PGlite.create({
    extensions: {
      pg_buffercache,
    },
  })

  await pg.exec('CREATE EXTENSION IF NOT EXISTS pg_buffercache;')

  const buffers = await pg.query(`
SELECT n.nspname, c.relname, count(*) AS buffers
FROM pg_buffercache b JOIN pg_class c
ON b.relfilenode = pg_relation_filenode(c.oid) AND
   b.reldatabase IN (0, (SELECT oid FROM pg_database
                         WHERE datname = current_database()))
JOIN pg_namespace n ON n.oid = c.relnamespace
GROUP BY n.nspname, c.relname
ORDER BY 3 DESC
LIMIT 10;    
`)

  expect(buffers.rows.length).toEqual(10)

  const bufferCacheSummary = await pg.query(
    `SELECT * FROM pg_buffercache_summary();`,
  )

  expect(bufferCacheSummary.rows.length).toEqual(1)

  await pg.query(`SELECT * FROM pg_buffercache_usage_counts();`)
})
