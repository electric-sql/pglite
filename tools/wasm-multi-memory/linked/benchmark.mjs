import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { setTimeout as delay } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { PGlitePostmaster } from '@electric-sql/pglite/postmaster'
import { vector } from '@electric-sql/pglite-pgvector'

const [mode, workload] = process.argv.slice(2)
assert.ok(
  workload === undefined ||
    ['storage', 'distances', 'heap-profile'].includes(workload),
)
const postmaster = mode === 'postmaster'
assert.ok(postmaster || mode === 'classic')
const options = {
  shared_buffers: '16MB',
  fsync: 'off',
  synchronous_commit: 'off',
  full_page_writes: 'off',
  autovacuum: 'off',
  io_method: 'sync',
  jit: 'off',
  max_parallel_workers_per_gather: '0',
  max_parallel_maintenance_workers: '0',
  maintenance_work_mem: '32MB',
}
const startParams = Object.entries(options).flatMap(([name, value]) => [
  '-c',
  name + '=' + value,
])
const directory = await mkdtemp(join(tmpdir(), 'pgvector-mode-'))
const dataDir = pathToFileURL(directory).href
let handle
let db

async function openSession() {
  for (let attempt = 0; ; attempt++) {
    try {
      return await handle.createSession()
    } catch (error) {
      if (error.code !== '57P03' || attempt >= 99) throw error
      await delay(25)
    }
  }
}

async function openDatabase() {
  if (postmaster) {
    handle = await PGlitePostmaster.create({
      dataDir,
      startParams,
      maxConnections: 4,
      scopedMemoryMode: 'dedicated',
      extensions: { vector },
    })
    db = await openSession()
    return
  }
  handle = db = await PGlite.create({
    dataDir,
    startParams: [...PGlite.defaultStartParams, ...startParams],
    extensions: { vector },
  })
}

try {
  await openDatabase()
  await db.exec('CREATE EXTENSION vector')
  assert.deepEqual(
    (await db.query("SELECT '[0,0]'::vector <-> '[3,4]'::vector AS distance"))
      .rows,
    [{ distance: 5 }],
  )
  const settings = (
    await db.query(
      `SELECT name, current_setting(name) AS value FROM pg_settings WHERE name = ANY($1::text[])`,
      [Object.keys(options)],
    )
  ).rows
  assert.deepEqual(
    Object.fromEntries(settings.map(({ name, value }) => [name, value])),
    options,
  )
  const metrics = {}
  await workloads(metrics)
  console.log(
    JSON.stringify({ mode, node: process.version, settings, metrics }),
  )
} finally {
  try {
    try {
      if (postmaster && db) await db.close()
    } finally {
      await handle?.close()
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

function median(samples) {
  const sorted = samples.toSorted((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return (sorted[middle] + sorted[Math.floor((sorted.length - 1) / 2)]) / 2
}

async function serverTime(sql, params) {
  const result = await db.query(
    'EXPLAIN (ANALYZE, TIMING OFF, FORMAT JSON) ' + sql,
    params,
  )
  const ms = result.rows[0]['QUERY PLAN'][0]['Execution Time']
  assert.ok(Number.isFinite(ms))
  return ms
}

async function workloadPlan(sql, params) {
  const result = await db.query('EXPLAIN (COSTS OFF) ' + sql, params)
  return result.rows.map((row) => row['QUERY PLAN']).join('\n')
}

async function workloads(metrics) {
  const n = 2048
  const clock = () => performance.now()
  await db.exec(`
    SELECT setseed(0.314);
    CREATE TABLE points(id integer PRIMARY KEY, v vector(768));
    INSERT INTO points SELECT id,
      ARRAY(SELECT (random()+0*id)::real FROM generate_series(1,768))::vector
      FROM generate_series(1,${n}) g(id);
    CREATE TABLE inline_points(id integer PRIMARY KEY, v vector(768));
    ALTER TABLE inline_points ALTER COLUMN v SET STORAGE PLAIN;
    INSERT INTO inline_points SELECT * FROM points;
    ANALYZE points; ANALYZE inline_points;
  `)
  if (workload === 'storage') {
    for (const table of ['points', 'inline_points']) {
      const toast = (
        await db.query(
          'SELECT reltoastrelid::regclass::text AS name FROM pg_class WHERE oid = $1::regclass',
          [table],
        )
      ).rows[0].name
      assert.match(toast, /^pg_toast\.pg_toast_[0-9]+$/)
      metrics[table + 'ToastChunks'] = Number(
        (await db.query('SELECT count(*) AS n FROM ' + toast)).rows[0].n,
      )
      for (const [label, expr, expected] of [
        ['id', 'id', (n * (n + 1)) / 2],
        ['dims', 'vector_dims(v)', n * 768],
      ]) {
        const sql = 'SELECT sum(' + expr + ') AS total FROM ' + table
        assert.equal(Number((await db.query(sql)).rows[0].total), expected)
        const times = []
        for (let i = 0; i < 20; i++) {
          const ms = await serverTime(sql)
          if (i >= 5) times.push(ms)
        }
        metrics[table + '_' + label + 'Ms'] = median(times)
      }
    }
    return
  }
  if (workload === 'distances') {
    // All operators visit the same rows and target vector; rotate their order.
    for (const table of ['points', 'inline_points']) {
      const names = ['l2', 'l1', 'cosine']
      const ops = ['<->', '<+>', '<=>']
      const samples = names.map(() => [])
      const sql = ops.map(
        (op) =>
          `SELECT sum(v ${op} (SELECT v FROM ${table} WHERE id=91)) AS checksum FROM ${table}`,
      )
      for (const [i, query] of sql.entries()) {
        assert.match(
          await workloadPlan(query),
          new RegExp('Seq Scan on ' + table),
        )
        metrics[table + '_' + names[i] + '_checksum'] = (
          await db.query(query)
        ).rows[0].checksum
      }
      for (let round = 0; round < 12; round++) {
        for (let j = 0; j < ops.length; j++) {
          const i = (j + round) % ops.length
          const ms = await serverTime(sql[i])
          if (round >= 3) samples[i].push(ms)
        }
      }
      for (const [i, timings] of samples.entries())
        metrics[table + '_' + names[i] + '_ms'] = median(timings)
    }
  }
  const roundTrips = []
  for (let round = 0; round < 7; round++) {
    const start = clock()
    for (let i = 0; i < 64; i++) {
      assert.equal((await db.query('SELECT 1 AS n')).rows[0].n, 1)
    }
    if (round >= 2) roundTrips.push((clock() - start) / 64)
  }
  metrics.roundTripMs = median(roundTrips)

  for (const [table, kind] of [
    ['points', 'default'],
    ['inline_points', 'inline'],
  ]) {
    const sql = `SELECT sum(v <-> (SELECT v FROM ${table} WHERE id=91)) AS checksum FROM ${table}`
    assert.match(await workloadPlan(sql), new RegExp('Seq Scan on ' + table))
    const times = []
    const server = []
    for (let i = 0; i < 10; i++) {
      const start = clock()
      const checksum = (await db.query(sql)).rows[0].checksum
      const elapsed = clock() - start
      assert.ok(checksum > 0)
      metrics.checksum ??= checksum
      assert.ok(Math.abs(checksum - metrics.checksum) < 1e-5)
      const execution = await serverTime(sql)
      if (i >= 3) {
        times.push(elapsed)
        server.push(execution)
      }
    }
    metrics[kind + 'ScanMs'] = median(times)
    metrics[kind + 'ServerMs'] = median(server)
  }
  const counters = Array.from(
    { length: 9 },
    (_, i) => 'heap_count_' + Math.floor(i / 3) + (i % 3),
  )
  async function snapshot() {
    const sql = counters.map((name) => name + '() AS ' + name).join(',')
    return (await db.query('SELECT ' + sql)).rows[0]
  }
  const difference = (end, start) =>
    Object.fromEntries(
      counters.map((name) => [name.slice(-2), end[name] - start[name]]),
    )
  let beforeBuild, beforeSearch
  if (workload === 'heap-profile') {
    for (const name of counters)
      await db.exec(
        `CREATE FUNCTION ${name}() RETURNS int AS '$libdir/vector', '${name}' LANGUAGE C VOLATILE`,
      )
    beforeBuild = await snapshot()
  }
  const buildStart = clock()
  await db.exec(
    'CREATE INDEX points_hnsw ON points USING hnsw(v vector_l2_ops)',
  )
  metrics.buildIndexMs = clock() - buildStart
  const sql =
    'SELECT id FROM points ORDER BY v <-> (SELECT v FROM points WHERE id=$1) LIMIT 10'
  assert.match(await workloadPlan(sql, [91]), /Index Scan using points_hnsw/)

  const idFor = (round, i) => 1 + ((round * 103 + i * 431) % n)
  async function searchBatch(sessions, round) {
    const start = clock()
    await Promise.all(
      sessions.map(async (session, offset) => {
        for (let i = offset; i < 64; i += sessions.length) {
          const result = await session.query(sql, [idFor(round, i)])
          assert.equal(result.rows.length, 10)
        }
      }),
    )
    return (clock() - start) / 64
  }
  if (workload === 'heap-profile') {
    beforeSearch = await snapshot()
    metrics.buildOperands = difference(beforeSearch, beforeBuild)
    for (let round = 0; round < 7; round++) await searchBatch([db], round)
    metrics.searchOperands = difference(await snapshot(), beforeSearch)
    assert.ok(Object.values(metrics.buildOperands).some((count) => count > 0))
    assert.ok(Object.values(metrics.searchOperands).some((count) => count > 0))
    return
  }
  const searches = []
  for (let round = 0; round < 7; round++) {
    const elapsed = await searchBatch([db], round)
    if (round >= 2) searches.push(elapsed)
  }
  metrics.searchMs = median(searches)
  const searchServer = []
  for (let i = 0; i < 64; i++)
    searchServer.push(await serverTime(sql, [idFor(6, i)]))
  metrics.searchServerMs = median(searchServer)

  if (postmaster) {
    const second = await openSession()
    try {
      const qps = { 1: [], 2: [] }
      for (let round = 0; round < 8; round++) {
        for (const count of round % 2 ? [2, 1] : [1, 2]) {
          const elapsed = await searchBatch(
            count === 2 ? [db, second] : [db],
            round,
          )
          if (round >= 2) qps[count].push(1000 / elapsed)
        }
      }
      metrics.oneSessionQps = median(qps[1])
      metrics.twoSessionsQps = median(qps[2])
    } finally {
      await second.close()
    }
  }

  await db.exec(`
    CREATE TEMP TABLE extra_points AS SELECT id,
      ARRAY(SELECT (random()+0*id)::real FROM generate_series(1,768))::vector(768) AS v
      FROM generate_series(${n + 1},${n + 128}) g(id)
  `)
  const insertStart = clock()
  await db.exec('INSERT INTO points SELECT * FROM extra_points')
  metrics.insert128Ms = clock() - insertStart
  assert.equal(
    (await db.query('SELECT count(*)::int AS n FROM points')).rows[0].n,
    n + 128,
  )
}
