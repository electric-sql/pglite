#!/usr/bin/env node

import assert from 'node:assert/strict'
import {
  chmod,
  cp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const [repoRootArg, postmasterTestArg, postgresTestArg, nativeArg] =
  process.argv.slice(2)
if (!nativeArg) {
  throw new Error(
    'usage: prepare-test-provider.mjs REPO_ROOT POSTMASTER_TEST POSTGRES_TEST NATIVE',
  )
}
const repoRoot = resolve(repoRootArg)
const postmasterTest = resolve(postmasterTestArg)
const postgresTest = resolve(postgresTestArg)
const native = resolve(nativeArg)
const pgRoot = join(repoRoot, 'postgres-pglite')
const source = join(repoRoot, 'tests/postgres/provider')
const provider = join(postgresTest, 'provider')
const target = process.env.PGLITE_POSTGRES_TEST_TARGET ?? 'check'
const jobs = Number.parseInt(process.env.PGLITE_POSTGRES_TEST_JOBS ?? '2', 10)
assert.ok(
  Number.isInteger(jobs) && jobs > 0,
  'invalid PostgreSQL test job count',
)
const resultsRoot = join(postgresTest, 'results', `raw-${target}`)
const revision = execFileSync('git', ['-C', pgRoot, 'rev-parse', 'HEAD'], {
  encoding: 'utf8',
}).trim()

await rm(provider, { recursive: true, force: true })
await mkdir(resultsRoot, { recursive: true })
await cp(source, provider, { recursive: true })
await Promise.all(
  ['initdb', 'postgres', 'pg_ctl', 'pglite-test-capability', 'prove'].map(
    (name) => chmod(join(provider, 'bin', name), 0o755),
  ),
)

const psql = join(native, 'build/src/bin/psql/psql')
await symlink(psql, join(provider, 'bin/psql'))

const capabilities = JSON.parse(
  await readFile(
    join(repoRoot, 'tests/postgres/postgres-test-capabilities.json'),
    'utf8',
  ),
)
capabilities.postgresRevision = revision
await writeFile(
  join(provider, 'capabilities.json'),
  `${JSON.stringify(capabilities, null, 2)}\n`,
)

const config = {
  schema: 1,
  architecture: process.arch,
  jobs,
  postgresRevision: revision,
  repoRoot,
  artifact: {
    wasm: join(postmasterTest, 'artifact/postmaster.wasm'),
    glue: join(postmasterTest, 'source-build/bin/pglite.js'),
    data: join(postmasterTest, 'source-build/bin/pglite.data'),
  },
  icuArchive: join(repoRoot, 'packages/pglite-icu-full/static/icu.76.tgz'),
  workerFilesystemModule: join(
    repoRoot,
    'packages/pglite/tests/fixtures/nodefs-filesystem.mjs',
  ),
  postgresExecutable: join(native, 'install/bin/postgres'),
  privateMaximumMemory: 1024 * 1024 * 1024,
  globalMaximumMemory: 1024 * 1024 * 1024,
  resultsRoot,
  capabilityEvents: join(resultsRoot, 'capabilities', 'events'),
  postgresSource: join(native, 'source'),
  postgresBuild: join(native, 'build'),
  mounts: [
    { root: join(postmasterTest, 'icu'), path: '/pglite/icu' },
    { root: postgresTest, path: postgresTest },
    { root: repoRoot, path: repoRoot },
    { root: '/tmp', path: '/tmp' },
  ],
}
for (const path of [
  config.artifact.wasm,
  config.artifact.glue,
  config.artifact.data,
  config.icuArchive,
  config.workerFilesystemModule,
  config.postgresExecutable,
  psql,
]) {
  assert.equal(typeof path, 'string')
}
await writeFile(
  join(provider, 'config.json'),
  `${JSON.stringify(config, null, 2)}\n`,
)
console.log(provider)
