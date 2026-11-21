import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [output, destination] = process.argv.slice(2)
const read = (...path) => JSON.parse(readFileSync(join(output, ...path)))
const entries = read('catalog.json')
const audit = read('packed-audit.json')
const feature = {
  amcheck: 'Check a system B-tree against its heap',
  auto_explain: 'Capture an execution plan notice',
  bloom: 'Bloom equality index scan',
  btree_gin: 'GIN integer index scan',
  btree_gist: 'GiST integer index scan',
  citext: 'Case-insensitive equality',
  cube: 'Euclidean distance',
  dict_int: 'Truncate an integer lexeme',
  dict_xsyn: 'Expand a synonym using the shipped dictionary',
  earthdistance: 'Distance between coordinates',
  file_fdw: 'Read a packaged file as a foreign table',
  fuzzystrmatch: 'Levenshtein distance',
  hstore: 'Look up a key',
  intarray: 'Sort and deduplicate integers',
  isn: 'Normalize an ISBN',
  lo: 'Unlink a large object using a delete trigger',
  ltree: 'Match a descendant path',
  pageinspect: 'Read heap line pointers',
  passwordcheck: 'Reject a short role password',
  pg_buffercache: 'Count occupied shared buffers',
  pg_freespacemap: 'Read free space in a relation',
  pg_logicalinspect:
    'Decode a publication and inspect metadata and builder state from a logical snapshot',
  pg_overexplain: 'Inspect plan node IDs with EXPLAIN (DEBUG)',
  pg_stat_statements: 'Find a previously executed query and its call count',
  pg_surgery: 'Kill a tuple by TID and verify its removal',
  pg_trgm: 'Check the GIN plan and substring matches',
  pg_visibility: 'Read the visibility map',
  pg_walinspect: 'Read block records across an insertion',
  pgcrypto: 'SHA-256 digest',
  seg: 'Normalize an interval',
  tablefunc: 'Generate a requested number of samples',
  tcn: 'Receive the inserted primary key in a notification',
  tsm_system_rows: 'Sample exactly two rows',
  tsm_system_time: 'Time-budgeted sampling of a one-page table',
  unaccent: 'Remove an accent',
  'uuid-ossp': 'Generate a deterministic v5 UUID',
  age: 'Evaluate Cypher against a graph',
  pg_hashids: 'Encode a known integer',
  pg_ivm: 'Read an incrementally updated sum',
  pg_textsearch: 'Rank documents using a BM25 index',
  pg_uuidv7: 'Generate a version-7 UUID',
  pgmq: 'Send and receive JSON',
  pgtap: 'Run a planned TAP assertion',
  postgis: 'Transform coordinates and normalize a Tiger address',
  vector: 'Compute L2 distance',
}
assert.deepEqual(entries.map((e) => e.name).sort(), Object.keys(feature).sort())
const lines = [
  '# Shipped extension qualification',
  '',
  'Each result covers Node 20.18.0 and 22.13.0 with a fresh database in each constructor. The verifier hashes the archive selected by the installed public wrapper and records each Wasm side module instantiated on the classic main thread or in a postmaster worker. Postmaster creates each SQL extension in one session and opens a fresh session for its feature test. LOAD hooks run in the session being measured.',
  '',
  'Contrib imports use `@electric-sql/pglite/contrib/<entry>`. Standalone imports use `@electric-sql/pglite-<entry>`. The existing test column names the package test file, or the upstream PostgreSQL suite. The qualification cases exercise the feature listed here.',
  '',
  '| Entry | Feature | Dependencies or startup configuration | Existing test | Classic | Postmaster |',
  '| --- | --- | --- | --- | --- | --- |',
]
const readOutcome = (engine, mode, name) =>
  read('behavior', engine, mode, name + '.json')
const summary = []
for (const { name, dir, symbol, bundled, importPath } of entries) {
  const descriptor = read('extensions', name + '.json')
  const manifest = descriptor.extensionManifest
  for (const module of manifest.sideModules)
    assert.equal(
      audit.sideModules[name + '.tar.gz/' + module.path],
      module.sha256,
    )
  const constraints = [
    ...new Set(manifest.postgresExtensions.flatMap((e) => e.requires)),
  ]
  const preloads = manifest.requiredSharedPreloadLibraries.map(
    (x) => 'preload ' + x,
  )
  if (name === 'pg_logicalinspect')
    constraints.push('wal_level=logical for snapshot generation')
  if (name === 'age') constraints.push('LOAD age, ag_catalog on search_path')
  if (name === 'postgis')
    constraints.push('base library before raster/topology, PROJ data')
  if (['auto_explain', 'passwordcheck', 'pg_overexplain'].includes(name))
    constraints.push('LOAD')
  const pkg = importPath
    .split('/')
    .pop()
    .replace(/^pglite-/, '')
  const testDir = bundled ? dir + '/tests/contrib' : dir + '/tests'
  const testBase = name === 'vector' ? 'pgvector' : symbol
  const file = ['ts', 'js']
    .map((ext) => testBase + '.test.' + ext)
    .find((file) => existsSync(join(testDir, file)))
  const existing = file || 'upstream contrib/' + name
  const outcome = {}
  for (const mode of ['classic', 'postmaster']) {
    outcome[mode] = ['node20', 'node22'].map((engine) => {
      const result = readOutcome(engine, mode, name)
      if (result.status !== 'pass')
        return (
          engine +
          ' failed at ' +
          (result.operation || 'startup or shutdown') +
          ' (' +
          result.error +
          ')'
        )
      if (result.archiveSha256 !== descriptor.archiveSha256)
        return engine + ' archive digest differs from SDK descriptor'
      const links = readFileSync(
        join(output, 'behavior', engine, mode, name + '-links.jsonl'),
        'utf8',
      )
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line))
      for (const module of manifest.sideModules)
        if (
          !links.some(
            ({ hash, threadId }) =>
              hash === module.sha256 &&
              (mode === 'classic' ? threadId === 0 : threadId > 0),
          )
        )
          return (
            engine +
            ' did not instantiate ' +
            module.path +
            ' with its SDK digest'
          )
      return 'pass'
    })
  }
  summary.push({
    name,
    importPath,
    archiveSha256: descriptor.archiveSha256,
    sideModules: manifest.sideModules.map(({ path, sha256 }) => ({
      path,
      sha256,
    })),
    outcome,
  })
  lines.push(
    '| ' +
      [
        `${bundled ? 'contrib' : 'standalone'} \`${pkg}\``,
        feature[name],
        [...constraints, ...preloads].join(', ') || '—',
        existing,
        ...Object.values(outcome).map((r) => [...new Set(r)].join(', ')),
      ].join(' | ') +
      ' |',
  )
}
lines.push(
  '',
  'The separate Node 20/22 pgvector and PostGIS suite exercises HNSW, concurrent transaction visibility, cancellation, parallel workers, GiST, PROJ, GDAL raster and topology. pgTAP and pgmq contain SQL and ship zero Wasm modules. Each of the three LOAD-only contrib archives has a public wrapper in the linked package.',
  '',
)
writeFileSync(destination ?? join(output, 'catalog.md'), lines.join('\n'))
writeFileSync(
  join(output, 'catalog-results.json'),
  JSON.stringify(summary, null, 2) + '\n',
)
if (
  summary.some((x) =>
    Object.values(x.outcome)
      .flat()
      .some((s) => s !== 'pass'),
  )
)
  process.exitCode = 1
