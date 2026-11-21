import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite-pgvector'

async function checkIndex(db) {
  await db.exec(`
    CREATE EXTENSION vector;
    CREATE TABLE points (id integer PRIMARY KEY, v vector(768));
    ALTER TABLE points ALTER COLUMN v SET STORAGE PLAIN;
    INSERT INTO points SELECT i, array_fill(i::real, ARRAY[768])::vector
      FROM generate_series(1, 256) i;
  `)
  const nearest =
    'SELECT id FROM points ORDER BY v <-> array_fill(120.125::real, ARRAY[768])::vector LIMIT 3'
  const expected = [{ id: 120 }, { id: 121 }, { id: 119 }]
  assert.deepEqual((await db.query(nearest)).rows, expected)
  await db.exec(
    'CREATE INDEX points_hnsw ON points USING hnsw (v vector_l2_ops); SET enable_seqscan = off',
  )
  const plan = await db.query('EXPLAIN (COSTS OFF) ' + nearest)
  assert.match(
    plan.rows.map((row) => row['QUERY PLAN']).join('\n'),
    /Index Scan using points_hnsw/,
  )
  assert.deepEqual((await db.query(nearest)).rows, expected)
  await db.exec(
    'INSERT INTO points VALUES (999, array_fill(120.125::real, ARRAY[768]))',
  )
  assert.equal((await db.query(nearest)).rows[0].id, 999)
}

async function checkParallelVector(db) {
  await db.exec(`
    CREATE TABLE parallel_points AS
      SELECT ARRAY[(i % 1000)::real,0,0]::vector(3) AS v FROM generate_series(1, 50000) i;
    ALTER TABLE parallel_points SET (parallel_workers = 2);
    ANALYZE parallel_points;
    SET min_parallel_table_scan_size = 0;
    SET max_parallel_workers_per_gather = 2;
    SET parallel_setup_cost = 0;
    SET parallel_tuple_cost = 0;
    SET parallel_leader_participation = off;
  `)
  const query = "SELECT sum(v <-> '[0,0,0]') AS distance FROM parallel_points"
  const plan = await db.query(
    'EXPLAIN (ANALYZE, TIMING OFF, FORMAT JSON) ' + query,
  )
  assert.match(JSON.stringify(plan.rows), /"Workers Launched":[1-9]/)
  assert.equal((await db.query(query)).rows[0].distance, 24975000)
}

async function checkCancel(writer, reader) {
  await writer.exec(`
    SET max_parallel_maintenance_workers = 0;
    CREATE TABLE building AS SELECT array_fill(i::real, ARRAY[16])::vector(16) AS v
      FROM generate_series(1, 12000) i;
  `)
  const [{ pid }] = (await writer.query('SELECT pg_backend_pid() AS pid')).rows
  const building = writer.exec(
    'CREATE INDEX interrupted ON building USING hnsw (v vector_l2_ops)',
  )
  // Observe the build inside pgvector before sending the signal.
  const result = building.then(
    () => null,
    (error) => error,
  )
  const deadline = performance.now() + 20000
  while (true) {
    const progress = await reader.query(
      'SELECT tuples_done FROM pg_stat_progress_create_index WHERE pid = $1 AND tuples_done > 0',
      [pid],
    )
    if (progress.rows.length) break
    assert.ok(performance.now() < deadline, 'HNSW build progress timed out')
    await delay(10)
  }
  assert.deepEqual(
    (await reader.query('SELECT pg_cancel_backend($1) AS ok', [pid])).rows,
    [{ ok: true }],
  )
  assert.equal((await result)?.code, '57014')
  assert.deepEqual(
    (await writer.query("SELECT to_regclass('interrupted') AS idx")).rows,
    [{ idx: null }],
  )
}

async function open(postmaster) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await postmaster.createSession()
    } catch (error) {
      if (error.code !== '57P03' || attempt === 99) throw error
      await delay(25)
    }
  }
}

async function checkLazyStartup(db) {
  if (!process.env.PGLITE_VERIFY_LAZY_EXTENSIONS) return
  assert.deepEqual((await db.query('SELECT 1 AS n')).rows, [{ n: 1 }])
  assert.equal(await readFile(process.env.PGLITE_OBSERVE_LOG, 'utf8'), '')
}

const [mode, profile] = process.argv.slice(2)
const sdk =
  profile === 'sdk' ? await import('./check-extensions.mjs') : undefined
const extensions = { vector, ...sdk?.extraExtensions }
assert.ok(mode === 'classic' || mode === 'postmaster')
assert.deepEqual(vector.backend.targetKeys, ['wasm32-faceted'])
if (mode === 'classic') {
  const db = await PGlite.create({ extensions })
  try {
    await checkLazyStartup(db)
    await checkIndex(db)
    await sdk?.checkExtraExtensions(db)
  } finally {
    await db.close()
  }
} else {
  const { PGlitePostmaster } = await import('@electric-sql/pglite/postmaster')
  const directory = await mkdtemp(join(tmpdir(), 'portable-pgvector-'))
  let postmaster
  try {
    postmaster = await PGlitePostmaster.create({
      dataDir: pathToFileURL(directory).href,
      maxConnections: 4,
      extensions,
    })
    const writer = await open(postmaster)
    const reader = await open(postmaster)
    try {
      await checkLazyStartup(reader)
      await checkIndex(writer)
      await sdk?.checkExtraExtensions(writer, reader)
      await writer.exec('BEGIN; DELETE FROM points WHERE id = 999')
      assert.deepEqual(
        (await reader.query('SELECT id FROM points WHERE id = 999')).rows,
        [{ id: 999 }],
      )
      await writer.exec('ROLLBACK')
      await checkParallelVector(writer)
      await checkCancel(writer, reader)
    } finally {
      await Promise.allSettled([writer.close(), reader.close()])
    }
  } finally {
    if (postmaster) await postmaster.close()
    await rm(directory, { recursive: true, force: true })
  }
}
console.log(
  `${sdk ? 'pgvector, PostGIS and independently built probe' : 'pgvector'} ${mode === 'postmaster' ? 'postmaster, two sessions, parallel pgvector and HNSW cancellation' : 'classic'} on ${process.version}: PASS`,
)
