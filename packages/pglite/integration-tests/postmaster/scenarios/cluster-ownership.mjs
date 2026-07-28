import assert from 'node:assert/strict'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

if (process.argv.length !== 7) {
  throw new Error(
    'usage: cluster-ownership.mjs REPO_ROOT WASM GLUE DATA OUTPUT',
  )
}

const [, , repoRoot, wasm, glue, data] = process.argv
const { PGlite } = await import(
  pathToFileURL(join(repoRoot, 'packages/pglite/dist/index.js')).href
)
const { PGlitePostmaster } = await import(
  pathToFileURL(join(repoRoot, 'packages/pglite/dist/postmaster/index.js')).href
)

const root = await mkdtemp(join(tmpdir(), 'pglite-cluster-ownership-'))
const dataDir = join(root, 'pgdata')
let classic
let postmaster

try {
  classic = await PGlite.create(`file://${dataDir}`)
  await classic.exec('create table ownership_probe(value integer)')
  const versionBefore = await stat(join(dataDir, 'PG_VERSION'))
  await assert.rejects(
    PGlitePostmaster.create({
      dataDir,
      artifact: { wasm, glue, data },
      initialize: false,
    }),
    (error) =>
      error?.name === 'PGliteClusterInUseError' &&
      error?.owner?.runtime === 'classic',
  )
  const versionAfter = await stat(join(dataDir, 'PG_VERSION'))
  assert.equal(versionAfter.mtimeMs, versionBefore.mtimeMs)
  await classic.close()
  classic = undefined

  postmaster = await PGlitePostmaster.create({
    dataDir,
    artifact: { wasm, glue, data },
    initialize: false,
  })
  await assert.rejects(
    PGlite.create(`file://${dataDir}`),
    (error) =>
      error?.name === 'PGliteClusterInUseError' &&
      error?.owner?.runtime === 'postmaster',
  )
  await postmaster.close()
  postmaster = undefined

  classic = await PGlite.create(`file://${dataDir}`)
  const result = await classic.query(
    'select count(*)::integer as count from ownership_probe',
  )
  assert.deepEqual(result.rows, [{ count: 0 }])
  await classic.close()
  classic = undefined

  console.log('Classic/postmaster cluster ownership test: PASS')
} finally {
  await postmaster?.close().catch(() => undefined)
  await classic?.close().catch(() => undefined)
  await rm(root, { recursive: true, force: true })
}
