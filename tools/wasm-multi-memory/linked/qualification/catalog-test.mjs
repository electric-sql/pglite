import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { PGlite } from '@electric-sql/pglite'
import { PGlitePostmaster } from '@electric-sql/pglite/postmaster'
import { cases } from './catalog-cases.mjs'

const [mode, name, output, results] = process.argv.slice(2)
const entries = JSON.parse(await readFile(join(output, 'catalog.json')))
const directory = await mkdtemp(join(tmpdir(), 'pglite-catalog-'))
let cluster,
  db,
  operation = 'resolve public import',
  archiveSha256
const sql = async (statement, options = {}) => {
  operation = statement
  return db.query(statement, [], options)
}
async function exec(statement) {
  operation = statement
  return db.exec(statement)
}
async function load(name) {
  const entry = entries.find((entry) => entry.name === name)
  const extension = (await import(entry.importPath))[entry.symbol]
  assert.deepEqual(extension.backend.targetKeys, ['wasm32-faceted'])
  const artifact = extension.backend.artifacts['wasm32-faceted']
  const hash = createHash('sha256')
    .update(await readFile(artifact.url))
    .digest('hex')
  assert.equal(hash, artifact.archiveSha256)
  return { extension, hash }
}
async function session() {
  for (let attempt = 0; ; attempt++) {
    try {
      return await cluster.createSession()
    } catch (error) {
      if (error.code !== '57P03' || attempt >= 99) throw error
      await delay(25)
    }
  }
}
let result = { name, mode, node: process.version }
try {
  const item = await load(name)
  archiveSha256 = item.hash
  const extensions = { [name]: item.extension }
  if (name === 'earthdistance') extensions.cube = (await load('cube')).extension
  if (name === 'postgis')
    extensions.fuzzystrmatch = (await load('fuzzystrmatch')).extension
  const wal = name === 'pg_logicalinspect' ? ['-c', 'wal_level=logical'] : []
  operation = 'start ' + mode
  if (mode === 'classic') {
    db = await PGlite.create({
      extensions,
      startParams: [...PGlite.defaultStartParams, ...wal],
    })
  } else {
    assert.equal(mode, 'postmaster')
    cluster = await PGlitePostmaster.create({
      dataDir: pathToFileURL(directory).href,
      extensions,
      startParams: wal,
    })
    db = await session()
  }
  if (['auto_explain', 'passwordcheck', 'pg_overexplain'].includes(name)) {
    await exec(`LOAD '${name}'`)
  } else {
    await exec(`CREATE EXTENSION "${name}" CASCADE`)
    if (cluster) {
      // Read the installed catalog from a second backend, with fresh module state.
      await db.close()
      db = await session()
    }
  }
  if (name === 'auto_explain') {
    await exec(
      "SET auto_explain.log_min_duration=0; SET auto_explain.log_level='notice'",
    )
    const notices = []
    await sql('SELECT count(*) FROM pg_class', {
      onNotice: (n) => notices.push(n.message),
    })
    assert.match(notices.join('\n'), /plan:/)
  } else if (name === 'passwordcheck') {
    await assert.rejects(
      sql("CREATE ROLE short_password PASSWORD 'short'"),
      /password is too short/,
    )
  } else if (name === 'pg_overexplain') {
    assert.match(
      JSON.stringify((await sql('EXPLAIN (DEBUG) SELECT 1')).rows),
      /Plan Node ID/,
    )
  } else if (name === 'pg_logicalinspect') {
    await sql(
      "SELECT * FROM pg_create_logical_replication_slot('inspect','pgoutput')",
    )
    await exec('CREATE TABLE sample(v int)')
    await exec('CREATE PUBLICATION inspector_pub FOR TABLE sample')
    await exec('INSERT INTO sample VALUES(1)')
    await exec('CHECKPOINT')
    const decoded = await sql(
      "SELECT count(*)::int AS n FROM pg_logical_slot_peek_binary_changes('inspect',NULL,NULL,'proto_version','1','publication_names','inspector_pub')",
    )
    assert.ok(decoded.rows[0].n > 0)
    await sql(
      "SELECT * FROM pg_replication_slot_advance('inspect',pg_current_wal_lsn())",
    )
    const snapshots = await sql(
      'SELECT m.magic, m.version, i.state FROM pg_ls_logicalsnapdir() f, LATERAL pg_get_logical_snapshot_meta(f.name) m, LATERAL pg_get_logical_snapshot_info(f.name) i',
    )
    assert.ok(
      snapshots.rows.some(
        (r) =>
          r.magic === 0x51a1e001 && r.version === 6 && r.state === 'consistent',
      ),
    )
  } else if (name === 'tcn') {
    await exec(
      'CREATE TABLE sample(id int PRIMARY KEY); CREATE TRIGGER change AFTER INSERT ON sample FOR EACH ROW EXECUTE FUNCTION triggered_change_notification()',
    )
    const messages = []
    await db.listen('tcn', (payload) => messages.push(payload))
    await exec('INSERT INTO sample VALUES(42)')
    for (let i = 0; i < 50 && !messages.length; i++) await delay(10)
    assert.deepEqual(messages, [`"sample",I,"id"='42'`])
  } else {
    const [setup, assertion, indexedQuery] = cases[name]
    if (setup) await exec(setup)
    if (indexedQuery)
      assert.match(
        JSON.stringify((await sql('EXPLAIN (COSTS OFF) ' + indexedQuery)).rows),
        /sample_idx/,
      )
    const { rows } = await sql(assertion)
    assert.deepEqual(
      rows.map((row) => Object.values(row)),
      [[true]],
    )
  }
  result = { ...result, status: 'pass', operation }
} catch (error) {
  result = {
    ...result,
    status: 'fail',
    operation,
    error: error.message,
    code: error.code,
  }
} finally {
  try {
    try {
      await db?.close()
    } finally {
      await cluster?.close()
    }
  } catch (error) {
    if (result.status !== 'fail')
      result = {
        ...result,
        status: 'fail',
        operation: 'shutdown',
        error: error.message,
      }
  }
  await rm(directory, { force: true, recursive: true })
}
await writeFile(
  join(results, mode, name + '.json'),
  JSON.stringify({ ...result, archiveSha256 }, null, 2) + '\n',
)
console.log(JSON.stringify(result))
if (result.status !== 'pass') process.exitCode = 1
