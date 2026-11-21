import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { PGlitePostmaster } from '@electric-sql/pglite/postmaster'
import { vector } from '@electric-sql/pglite-pgvector'
import { postgis } from '@electric-sql/pglite-postgis'

const directory = await mkdtemp('/tmp/parallel-leader-')
const [engine, output] = process.argv.slice(2)
const cluster = await PGlitePostmaster.create({
  dataDir: pathToFileURL(directory).href,
  extensions: { vector, postgis },
  scopedMemoryMode: 'dedicated',
})
async function connect() {
  for (let attempt = 0; ; attempt++) {
    try {
      return await cluster.createSession()
    } catch (error) {
      if (error.code !== '57P03' || attempt === 99) throw error
      await delay(25)
    }
  }
}
async function aggregate(db) {
  await db.exec(
    'SET max_parallel_workers_per_gather=2; SET min_parallel_table_scan_size=0; SET parallel_setup_cost=0; SET parallel_tuple_cost=0; SET parallel_leader_participation=off',
  )
  try {
    const sql = 'SELECT sum(id::bigint*id)::text AS n FROM items'
    const { rows } = await db.query(
      'EXPLAIN (ANALYZE, TIMING OFF, FORMAT JSON) ' + sql,
    )
    const gather = rows[0]['QUERY PLAN'][0].Plan.Plans[0]
    assert.equal(gather['Workers Launched'], 2)
    assert.equal(
      (await db.query(sql)).rows[0].n,
      String((32768n * 32769n * 65537n) / 6n),
    )
    return { workers: 2 }
  } catch (error) {
    if (!error.code || error.code === 'ERR_ASSERTION') throw error
    return { code: error.code, message: error.message, where: error.where }
  }
}
try {
  const loaded = await connect()
  await loaded.exec(
    "CREATE EXTENSION vector; CREATE EXTENSION postgis; SELECT '[0]'::vector <-> '[1]'::vector, ST_X(ST_Point(1,2)); CREATE TABLE items AS SELECT generate_series(1,32768) AS id; ALTER TABLE items SET (parallel_workers=2); ANALYZE items",
  )
  const fresh = await connect()
  const result = {
    engine,
    fresh: await aggregate(fresh),
    loaded: await aggregate(loaded),
  }
  assert.equal(result.fresh.workers, 2)
  await writeFile(output, JSON.stringify(result, null, 2) + '\n')
  await fresh.close()
  await loaded.close()
} finally {
  await cluster.close()
  await rm(directory, { recursive: true, force: true })
}
