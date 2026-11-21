import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { PGlite } from '@electric-sql/pglite'
import { PGlitePostmaster } from '@electric-sql/pglite/postmaster'
import { vector } from '@electric-sql/pglite-pgvector'
import { postgis } from '@electric-sql/pglite-postgis'

const [engine, mode, stage, round, output] = process.argv.slice(2)
const postmaster = mode === 'postmaster'
const directory = await mkdtemp('/tmp/pglite-system-')
const settings = {
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
const common = {
  extensions: { vector, postgis },
  dataDir: pathToFileURL(directory).href,
  startParams: Object.entries(settings).flatMap(([k, v]) => [
    '-c',
    k + '=' + v,
  ]),
}
const result = {
  engine,
  mode,
  stage,
  round: Number(round),
  node: process.version,
  settings,
  plans: {},
  latency: {},
  throughput: {},
  memory: {},
  checks: {},
  storage: {},
}
const median = (samples) => {
  const sorted = samples.toSorted((a, b) => a - b)
  return (
    (sorted[Math.floor((sorted.length - 1) / 2)] +
      sorted[Math.floor(sorted.length / 2)]) /
    2
  )
}
let cluster, db
const now = () => performance.now()
async function connect() {
  for (let i = 0; ; i++) {
    try {
      return await cluster.createSession()
    } catch (e) {
      if (e.code !== '57P03' || i >= 99) throw e
      await delay(25)
    }
  }
}
const rows = async (sql, params = []) => (await db.query(sql, params)).rows
async function plan(key, sql, params = [], analyze = false) {
  const [
    {
      'QUERY PLAN': [root],
    },
  ] = await rows(
    'EXPLAIN (' +
      (analyze ? 'ANALYZE, TIMING OFF, ' : '') +
      'COSTS OFF, FORMAT JSON) ' +
      sql,
    params,
  )
  const structure = (node) =>
    Object.fromEntries([
      ...[
        'Node Type',
        'Strategy',
        'Join Type',
        'Index Name',
        'Relation Name',
        'Parallel Aware',
        'Workers Planned',
      ]
        .filter((k) => k in node)
        .map((k) => [k, node[k]]),
      ...(node.Plans ? [['Plans', node.Plans.map(structure)]] : []),
    ])
  result.plans[key] = structure(root.Plan)
  return root
}
async function latency(key, query, params, expected, n = 9, warm = 3) {
  await plan(key, query, params)
  const times = []
  for (let i = 0; i < warm + n; i++) {
    const t = now()
    const data = await rows(query, params)
    const dt = now() - t
    expected(data)
    if (i >= warm) times.push(dt)
  }
  result.latency[key] = median(times)
}
function memory() {
  const rss = process.memoryUsage.rss()
  if (!cluster) return { rss, privateBytes: db.mod.HEAPU8.byteLength }
  const {
    privateMemoryBytes,
    globalMemoryBytes,
    scopedMemoryBytes,
    livePrivateMemories,
  } = cluster.diagnostics()
  return {
    rss,
    privateBytes: privateMemoryBytes,
    globalBytes: globalMemoryBytes,
    scopedBytes: scopedMemoryBytes,
    privateHeaps: livePrivateMemories,
  }
}
const point = 'SELECT id FROM items WHERE id=$1'
const update = 'UPDATE items SET score=1-score WHERE id=$1 RETURNING id'
const joinSQL =
  'SELECT sum(a.id+b.id)::int AS n FROM items a JOIN groups b ON b.id=a.grp'
const search =
  'SELECT id FROM points ORDER BY v <-> (SELECT v FROM points WHERE id=$1) LIMIT 10'
const spatial =
  'SELECT sum(id)::int AS n FROM places WHERE ST_Intersects(p, ST_MakeEnvelope(10,10,19,19))'
const agg = 'SELECT sum(id::bigint*id)::text AS n FROM items'
const expectedSum = ((32768n * 32769n * 65537n) / 6n).toString()
const assertN = (n) => (data) => assert.equal(data[0].n, n)
async function storage() {
  // PLAIN and EXTERNAL guarantee that the same byte string is inline or out of line.
  for (const table of ['inline_payload', 'external_payload']) {
    await db.exec(
      'CREATE TABLE ' +
        table +
        '(id int, p bytea); ALTER TABLE ' +
        table +
        ' ALTER COLUMN p SET STORAGE ' +
        (table === 'inline_payload' ? 'PLAIN' : 'EXTERNAL') +
        '; INSERT INTO ' +
        table +
        " SELECT i,decode(repeat(md5(i::text),192),'hex') FROM generate_series(1,1024) i; ANALYZE " +
        table,
    )
    const [{ rel }] = await rows(
      'SELECT reltoastrelid::regclass::text AS rel FROM pg_class WHERE oid=$1::regclass',
      [table],
    )
    assert.match(rel, /^pg_toast\.pg_toast_\d+$/)
    const [{ n }] = await rows('SELECT count(*)::int AS n FROM ' + rel)
    assert.equal(n, table === 'inline_payload' ? 0 : 2048)
    result.storage[table] = n
    for (const [op, expr] of [
      ['heap', 'id'],
      ['detoast', 'get_byte(p,1000)'],
      ['copy', 'get_byte(set_byte(p,1000,42),1000)'],
    ]) {
      const key = table + '_' + op,
        sql = 'SELECT sum(' + expr + ')::int AS n FROM ' + table
      const expected =
        op === 'heap'
          ? (1024 * 1025) / 2
          : op === 'copy'
            ? 42 * 1024
            : Number(
                (
                  await rows(
                    "SELECT sum(get_byte(decode(md5(i::text),'hex'),8)) AS n FROM generate_series(1,1024)i",
                  )
                )[0].n,
              )
      globalThis.pglMeasurePhase?.(key)
      await latency(
        key,
        sql,
        [],
        assertN(expected),
        process.env.PGLITE_PROFILE_SCAN === key ? 600 : 9,
      )
      globalThis.pglMeasurePhase?.('')
      result.checks[key] = expected
    }
  }
}
async function run() {
  const start = now(),
    baseRss = process.memoryUsage.rss()
  if (globalThis.pglStartupEvent) {
    const create = PGlite.create.bind(PGlite)
    PGlite.create = async (...args) => {
      const begin = now()
      try {
        return await create(...args)
      } finally {
        globalThis.pglStartupEvent('classic initialization', begin)
      }
    }
  }
  if (postmaster) {
    cluster = await PGlitePostmaster.create({
      ...common,
      maxConnections: 12,
      scopedMemoryMode: 'dedicated',
    })
    globalThis.pglStartupEvent?.(
      'cluster ready',
      start,
      cluster.diagnostics().extensionPreparationMilliseconds,
    )
    const connecting = now()
    db = await connect()
    globalThis.pglStartupEvent?.('first connection', connecting)
  } else
    db = await PGlite.create({
      ...common,
      startParams: [...PGlite.defaultStartParams, ...common.startParams],
    })
  await db.query('SELECT 1')
  result.startupMs = now() - start
  globalThis.pglStartupEvent?.('first query complete', start)
  result.baseRss = baseRss
  const effective = Object.fromEntries(
    (
      await rows(
        'SELECT name,setting, current_setting(name) AS value FROM pg_settings WHERE name=ANY($1::text[])',
        [Object.keys(settings)],
      )
    ).map((r) => [r.name, r.value]),
  )
  assert.deepEqual(effective, settings)
  const extensionStart = now()
  await db.exec('CREATE EXTENSION vector; CREATE EXTENSION postgis')
  result.createExtensionsMs = now() - extensionStart
  if (stage === 'startup') {
    result.memory[1] = memory()
    return
  }
  if (stage === 'storage') {
    await storage()
    return
  }
  const sessions = [db]
  result.memory[1] = memory()
  if (postmaster)
    for (let n = 2; n <= 8; n++) {
      const session = await connect()
      await session.query('SELECT 1')
      sessions.push(session)
      if ([2, 4, 8].includes(n)) result.memory[n] = memory()
    }
  await db.exec(`CREATE TABLE items(id int PRIMARY KEY, grp int NOT NULL, score int);
    INSERT INTO items SELECT i,i%64,0 FROM generate_series(1,32768)i;
    CREATE INDEX items_score ON items(score);
    CREATE TABLE groups(id int PRIMARY KEY);
    INSERT INTO groups SELECT generate_series(0,63);
    CREATE TABLE places AS SELECT i AS id, ST_Point(i%128,i/128) AS p FROM generate_series(0,16383)i;
    CREATE INDEX places_gist ON places USING gist(p);
    ANALYZE items; ANALYZE groups; ANALYZE places`)
  await latency('point', point, [91], (v) => assert.equal(v[0].id, 91), 65, 12)
  await latency(
    'indexed_update',
    update,
    [91],
    (v) => assert.equal(v[0].id, 91),
    65,
    12,
  )
  await latency(
    'join',
    joinSQL,
    [],
    assertN((32768 * 32769) / 2 + (512 * 63 * 64) / 2),
  )
  let spatialSum = 0
  for (let y = 10; y <= 19; y++)
    for (let x = 10; x <= 19; x++) spatialSum += 128 * y + x
  await latency('spatial', spatial, [], assertN(spatialSum))
  assert.match(JSON.stringify(result.plans.spatial), /places_gist/)
  await storage()
  await db.exec(`SELECT setseed(0.314);
    CREATE TABLE points(id int PRIMARY KEY, v vector(768));
    INSERT INTO points SELECT id, ARRAY(SELECT (random()+0*id)::real FROM generate_series(1,768))::vector FROM generate_series(1,2048) g(id);
    ANALYZE points`)
  result.checks.vectors = (
    await rows(
      'SELECT sum(v <-> (SELECT v FROM points WHERE id=91)) AS n FROM points',
    )
  )[0].n
  let startBuild = now()
  await db.exec(
    'CREATE INDEX points_hnsw ON points USING hnsw(v vector_l2_ops)',
  )
  result.latency.hnsw_build = now() - startBuild
  globalThis.pglMeasurePhase?.('')
  await plan('hnsw_search', search, [91])
  assert.match(JSON.stringify(result.plans.hnsw_search), /points_hnsw/)
  if (stage === 'profile') {
    globalThis.pglMeasurePhase('hnsw_search')
    for (let i = 0; i < 8; i++)
      assert.equal((await rows(search, [1 + i * 231])).length, 10)
    globalThis.pglMeasurePhase('')
    for (const s of sessions.slice(1)) await s.close()
    return
  }
  const rates =
    stage === 'attribute'
      ? [['hnsw_search', search]]
      : [
          ['point', point],
          ['hnsw_search', search],
        ]
  for (const [name, query] of rates) {
    if (name === 'hnsw_search') globalThis.pglMeasurePhase?.(name)
    result.throughput[name] = {}
    for (const n of postmaster && stage !== 'attribute' ? [1, 2, 4, 8] : [1]) {
      const samples = []
      let hits = 0
      for (let block = 0; block < 5; block++) {
        const t = now()
        await Promise.all(
          sessions.slice(0, n).map(async (s, k) => {
            for (let i = k; i < 64; i += n) {
              const id = 1 + ((block * 103 + i * 431) % 2048)
              const { rows: r } = await s.query(query, [id])
              assert.equal(r.length, name === 'point' ? 1 : 10)
              if (name === 'point') assert.equal(r[0].id, id)
              else if (r[0].id === id) hits++
            }
          }),
        )
        if (block >= 2) samples.push((now() - t) / 64)
      }
      if (name === 'hnsw_search') {
        assert.ok(
          hits > 160,
          'index returned the source row in fewer than half of self-queries',
        )
        result.checks['hnswHits' + n] = hits
      }
      result.throughput[name][n] = 1000 / median(samples)
      if (name === 'hnsw_search' && n === 1)
        result.latency.hnsw_search = median(samples)
    }
  }
  globalThis.pglMeasurePhase?.('')
  if (stage === 'attribute') {
    for (const s of sessions.slice(1)) await s.close()
    return
  }
  // Compare an identical serial aggregate on all four engines, then verify the actual worker plan.
  await latency('serial_aggregate', agg, [], assertN(expectedSum))
  if (postmaster) {
    // Start the core parallel query in a backend which has only executed core SQL.
    const leader = db
    db = await connect()
    try {
      await db.exec(
        'ALTER TABLE items SET (parallel_workers=2); SET max_parallel_workers_per_gather=2; SET min_parallel_table_scan_size=0; SET parallel_setup_cost=0; SET parallel_tuple_cost=0; SET parallel_leader_participation=off',
      )
      await latency('parallel_aggregate', agg, [], assertN(expectedSum))
      const analyzed = await plan('parallel_aggregate', agg, [], true)
      assert.match(JSON.stringify(analyzed.Plan), /"Workers Launched":2/)
    } finally {
      await db.close()
      db = leader
    }
  }
  for (const s of sessions.slice(1)) await s.close()
}
try {
  await run()
  await writeFile(output, JSON.stringify(result, null, 2) + '\n')
} finally {
  try {
    await db?.close()
  } finally {
    await cluster?.close()
    await rm(directory, { recursive: true, force: true })
  }
}
