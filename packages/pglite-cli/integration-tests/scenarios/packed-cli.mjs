#!/usr/bin/env node

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { createServer as createHttpServer } from 'node:http'
import { createServer as createNetServer } from 'node:net'
import {
  access,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises'
import { join } from 'node:path'

const [repoRoot, nativeRoot, outputRoot] = process.argv.slice(2)
if (!outputRoot) {
  throw new Error('usage: packed-cli.mjs REPO_ROOT NATIVE_ROOT OUTPUT_ROOT')
}

const packRoot = join(outputRoot, 'packs')
const projectRoot = join(outputRoot, 'project')
const dataDirectory = join(projectRoot, 'pgdata')
const serverLog = join(outputRoot, 'postgres.log')
const psql = join(nativeRoot, 'build/src/bin/psql/psql')
const libraryPath = join(nativeRoot, 'build/src/interfaces/libpq')
const nativeCommands = [
  'pg_isready',
  'psql',
  'pg_dump',
  'pg_restore',
  'createdb',
  'createuser',
  'dropdb',
  'dropuser',
  'clusterdb',
  'vacuumdb',
  'reindexdb',
]
let postgres

try {
  await rm(outputRoot, { recursive: true, force: true })
  await mkdir(packRoot, { recursive: true })
  await mkdir(projectRoot, { recursive: true })
  await packPackages()
  await installPackages()
  await assertPackedArtifactOwnership()
  await assertPnpmPackedCoreServer()

  const executable = join(projectRoot, 'node_modules/.bin/pglite')
  await access(executable)

  await assertNpxTarball()

  await assertProgrammaticImports()
  await assertNativeCommandContracts(executable)
  await assertInitdbAuthentication(executable)

  const initEnvironment = {
    ...process.env,
    USER: 'host-user-without-a-postgres-role',
    LOGNAME: 'host-user-without-a-postgres-role',
    PGUSER: undefined,
  }
  const init = await run(executable, ['initdb', '-D', dataDirectory], {
    cwd: projectRoot,
    env: initEnvironment,
  })
  assert.equal(init.code, 0, `${init.stdout}\n${init.stderr}`)
  assert.match(await readFile(join(dataDirectory, 'PG_VERSION'), 'utf8'), /^18/)

  const port = await reservePort()
  const environment = {
    ...process.env,
    PGHOST: '127.0.0.1',
    PGPORT: String(port),
    PGDATABASE: 'postgres',
    PGUSER: 'postgres',
    PGSSLMODE: 'disable',
  }
  postgres = spawn(
    executable,
    [
      'postgres',
      '-D',
      dataDirectory,
      '-c',
      'listen_addresses=127.0.0.1',
      '-c',
      `port=${port}`,
      '-c',
      'unix_socket_directories=',
    ],
    {
      cwd: projectRoot,
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  const output = collectOutput(postgres)
  await waitUntilReady(executable, environment, output)

  const queryEnvironment = {
    ...environment,
    LD_LIBRARY_PATH: libraryPath,
  }
  const concurrent = await Promise.all(
    ['first', 'second'].map((value) =>
      run(
        psql,
        [
          '-X',
          '--no-psqlrc',
          '-A',
          '-t',
          '-v',
          'ON_ERROR_STOP=1',
          '-c',
          `SELECT '${value}:' || pg_backend_pid() FROM (SELECT pg_sleep(0.1)) AS pause`,
        ],
        { cwd: projectRoot, env: queryEnvironment },
      ),
    ),
  )
  for (const result of concurrent) {
    assert.equal(result.code, 0, result.stderr)
    assert.match(result.stdout, /^(first|second):\d+$/m)
  }

  postgres.kill('SIGHUP')
  const afterReload = await waitForSuccess(
    () =>
      run(
        psql,
        ['-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', 'SELECT 42'],
        { cwd: projectRoot, env: queryEnvironment },
      ),
    30_000,
  )
  assert.match(afterReload.stdout, /^42$/m)

  const wasmPsql = await run(
    executable,
    [
      'psql',
      '-X',
      '--no-psqlrc',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      "CREATE TABLE cli_archive_test(value text); INSERT INTO cli_archive_test VALUES ('restored');",
    ],
    { cwd: projectRoot, env: environment },
  )
  assert.equal(wasmPsql.code, 0, wasmPsql.stderr)

  const streamedPsql = await run(
    executable,
    ['psql', '-X', '--no-psqlrc', '-v', 'ON_ERROR_STOP=1'],
    {
      cwd: projectRoot,
      env: environment,
      input: String.raw`\pset format unaligned
\pset tuples_only on
COPY cli_archive_test(value) FROM STDIN;
streamed
\.
SELECT value FROM cli_archive_test WHERE value = 'streamed';
`,
    },
  )
  assert.equal(streamedPsql.code, 0, streamedPsql.stderr)
  assert.match(streamedPsql.stdout, /^streamed$/m)

  for (const [command, args] of [
    ['createdb', ['cli_admin_test']],
    [
      'createuser',
      ['--no-superuser', '--no-createdb', '--no-createrole', 'cli_role_test'],
    ],
    ['vacuumdb', ['--analyze', 'postgres']],
    ['reindexdb', ['postgres']],
    ['clusterdb', ['postgres']],
  ]) {
    const result = await run(executable, [command, ...args], {
      cwd: projectRoot,
      env: environment,
    })
    assert.equal(result.code, 0, `${command}: ${result.stderr}`)
  }

  const plainArchive = join(projectRoot, 'cli-archive.sql')
  const customArchive = join(projectRoot, 'cli-archive.dump')
  const tarArchive = join(projectRoot, 'cli-archive.tar')
  const directoryArchive = join(projectRoot, 'cli-archive-directory')
  for (const [format, archive] of [
    ['plain', plainArchive],
    ['custom', customArchive],
    ['tar', tarArchive],
    ['directory', directoryArchive],
  ]) {
    const dump = await run(
      executable,
      ['pg_dump', `--format=${format}`, '--file', archive, 'postgres'],
      { cwd: projectRoot, env: environment },
    )
    assert.equal(dump.code, 0, `${format}: ${dump.stderr}`)
  }
  assert.match(await readFile(plainArchive, 'utf8'), /cli_archive_test/)
  assert.ok((await readFile(customArchive)).byteLength > 1_000)
  assert.ok((await readFile(tarArchive)).byteLength > 1_000)
  await access(join(directoryArchive, 'toc.dat'))

  for (const archive of [customArchive, tarArchive, directoryArchive]) {
    const list = await run(executable, ['pg_restore', '--list', archive], {
      cwd: projectRoot,
      env: environment,
    })
    assert.equal(list.code, 0, list.stderr)
    assert.match(list.stdout, /cli_archive_test/)
  }

  const dropTable = await run(
    executable,
    [
      'psql',
      '-X',
      '--no-psqlrc',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      'DROP TABLE cli_archive_test',
    ],
    { cwd: projectRoot, env: environment },
  )
  assert.equal(dropTable.code, 0, dropTable.stderr)
  const restore = await run(
    executable,
    ['pg_restore', '--dbname=postgres', customArchive],
    { cwd: projectRoot, env: environment },
  )
  assert.equal(restore.code, 0, restore.stderr)
  const restored = await run(
    executable,
    [
      'psql',
      '-X',
      '--no-psqlrc',
      '-A',
      '-t',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      'SELECT value FROM cli_archive_test',
    ],
    { cwd: projectRoot, env: environment },
  )
  assert.equal(restored.code, 0, restored.stderr)
  assert.match(restored.stdout, /^restored$/m)

  for (const [command, name] of [
    ['dropuser', 'cli_role_test'],
    ['dropdb', 'cli_admin_test'],
  ]) {
    const result = await run(executable, [command, name], {
      cwd: projectRoot,
      env: environment,
    })
    assert.equal(result.code, 0, `${command}: ${result.stderr}`)
  }

  postgres.kill('SIGTERM')
  const exit = await childExit(postgres, 30_000)
  postgres = undefined
  await writeFile(serverLog, `${output.stdout()}${output.stderr()}`)
  assert.equal(
    exit.code,
    0,
    `server exit ${JSON.stringify(exit)}\n${output.stderr()}`,
  )
  await assert.rejects(access(join(dataDirectory, 'postmaster.pid')))
  await assertExplicitServer(executable, dataDirectory)
} finally {
  if (postgres && postgres.exitCode === null && postgres.signalCode === null) {
    postgres.kill('SIGQUIT')
    await childExit(postgres, 15_000).catch(() => undefined)
  }
}

async function packPackages() {
  for (const packageDirectory of [
    'packages/pglite',
    'packages/pglite-server',
    'packages/pglite-tools',
    'packages/pglite-cli',
  ]) {
    const result = await run('pnpm', ['pack', '--pack-destination', packRoot], {
      cwd: join(repoRoot, packageDirectory),
    })
    assert.equal(result.code, 0, result.stderr)
  }
  const archives = (await readdir(packRoot)).filter((name) =>
    name.endsWith('.tgz'),
  )
  assert.equal(archives.length, 4, JSON.stringify(archives))
}

async function installPackages() {
  await writeFile(
    join(projectRoot, 'package.json'),
    `${JSON.stringify({ name: 'pglite-packed-test', private: true }, null, 2)}\n`,
  )
  const archives = (await readdir(packRoot))
    .filter((name) => name.endsWith('.tgz'))
    .map((name) => join(packRoot, name))
  const result = await run(
    'npm',
    [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--save-exact',
      ...archives,
    ],
    { cwd: projectRoot },
  )
  assert.equal(result.code, 0, result.stderr)
}

async function assertPackedArtifactOwnership() {
  const modules = join(projectRoot, 'node_modules')
  const corePackage = join(modules, '@electric-sql/pglite')
  const serverPackage = join(modules, '@electric-sql/pglite-server')
  const toolsPackage = join(modules, '@electric-sql/pglite-tools')
  const distributionPackage = join(modules, 'pglite')
  const core = join(corePackage, 'dist')
  const tools = join(toolsPackage, 'dist')

  await access(join(core, 'postmaster.wasm'))
  await access(join(core, 'postmaster/process-worker.js'))
  await access(join(tools, 'native/psql.wasm'))
  await assert.rejects(access(join(core, 'native/psql.wasm')))
  await assert.rejects(access(join(tools, 'postmaster.wasm')))

  for (const directory of [serverPackage, distributionPackage]) {
    const files = await recursiveFiles(directory)
    assert.equal(
      files.some(
        (file) =>
          file.endsWith('.wasm') ||
          file.endsWith('.data') ||
          /(?:^|\/)process-worker\./.test(file),
      ),
      false,
      `${directory} contains a core runtime artifact`,
    )
  }
}

async function recursiveFiles(directory, relative = '') {
  const files = []
  for (const entry of await readdir(join(directory, relative), {
    withFileTypes: true,
  })) {
    const path = join(relative, entry.name)
    if (entry.isDirectory())
      files.push(...(await recursiveFiles(directory, path)))
    else files.push(path)
  }
  return files
}

async function assertPnpmPackedCoreServer() {
  const pnpmProject = join(outputRoot, 'pnpm-project')
  await mkdir(pnpmProject, { recursive: true })
  const archives = await readdir(packRoot)
  const coreArchive = archives.find((name) =>
    /^electric-sql-pglite-[0-9].*\.tgz$/.test(name),
  )
  const serverArchive = archives.find((name) =>
    /^electric-sql-pglite-server-.*\.tgz$/.test(name),
  )
  assert.ok(coreArchive)
  assert.ok(serverArchive)
  await writeFile(
    join(pnpmProject, 'package.json'),
    `${JSON.stringify(
      {
        name: 'pglite-pnpm-packed-test',
        private: true,
        type: 'module',
        dependencies: {
          '@electric-sql/pglite': `file:${join(packRoot, coreArchive)}`,
          '@electric-sql/pglite-server': `file:${join(packRoot, serverArchive)}`,
        },
      },
      null,
      2,
    )}\n`,
  )
  const install = await run(
    'pnpm',
    [
      'install',
      '--ignore-workspace',
      '--ignore-scripts',
      '--store-dir',
      '/tmp/pnpm-store',
    ],
    { cwd: pnpmProject },
  )
  assert.equal(install.code, 0, `${install.stdout}\n${install.stderr}`)
  await assert.rejects(
    access(join(pnpmProject, 'node_modules/@electric-sql/pglite/src')),
  )

  const commonjs = await run(
    process.execPath,
    [
      '-e',
      `const { PGlitePostmaster } = require('@electric-sql/pglite/postmaster')
const { PGliteServer } = require('@electric-sql/pglite-server')
if (typeof PGlitePostmaster.create !== 'function' || typeof PGliteServer.create !== 'function') process.exit(9)`,
    ],
    { cwd: pnpmProject },
  )
  assert.equal(commonjs.code, 0, commonjs.stderr)
  await assertPackedServerLifecycles(pnpmProject)
}

async function assertPackedServerLifecycles(pnpmProject) {
  const script = join(pnpmProject, 'server-lifecycles.mjs')
  const lifecycleRoot = join(pnpmProject, 'lifecycles')
  await mkdir(lifecycleRoot, { recursive: true })
  await writeFile(
    script,
    `import assert from 'node:assert/strict'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { PGlitePostmaster } from '@electric-sql/pglite/postmaster'
import { PGliteServer } from '@electric-sql/pglite-server'

const root = process.argv[2]
const options = (name) => ({
  dataDir: pathToFileURL(join(root, name)).href,
  maxConnections: 4,
  sharedBuffers: '16MB',
})
const readySession = async (postmaster) => {
  let last
  for (let attempt = 0; attempt < 100; attempt++) {
    try { return await postmaster.createSession() }
    catch (error) {
      last = error
      if (error?.code !== '57P03') throw error
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
  }
  throw last
}

const caller = await PGlitePostmaster.create(options('caller-owned'))
const callerServer = await PGliteServer.create({
  postmaster: caller,
  listen: { host: '127.0.0.1', port: 0 },
})
try {
  let session = await readySession(caller)
  assert.deepEqual((await session.query('SELECT 6 * 7 AS answer')).rows, [{ answer: 42 }])
  await session.close()
  await callerServer.close()
  session = await readySession(caller)
  assert.deepEqual((await session.query('SELECT 7 * 7 AS answer')).rows, [{ answer: 49 }])
  await session.close()
} finally {
  await callerServer.close().catch(() => undefined)
  await caller.shutdown('fast')
}

const owned = await PGliteServer.create({
  postmaster: options('server-owned'),
  listen: { host: '127.0.0.1', port: 0 },
})
const ownedPostmaster = owned.postmaster
const ownedSession = await readySession(ownedPostmaster)
assert.deepEqual((await ownedSession.query('SELECT 8 * 8 AS answer')).rows, [{ answer: 64 }])
await ownedSession.close()
await owned.close({ mode: 'fast' })
assert.equal(ownedPostmaster.diagnostics().liveProcesses, 0)
`,
  )
  const lifecycle = await run(process.execPath, [script, lifecycleRoot], {
    cwd: pnpmProject,
  })
  assert.equal(lifecycle.code, 0, lifecycle.stderr)
}

async function assertNativeCommandContracts(executable) {
  for (const command of nativeCommands) {
    const help = await run(executable, [command, '--help'], {
      cwd: projectRoot,
    })
    assert.equal(help.code, 0, `${command} --help: ${help.stderr}`)
    assert.match(help.stdout, new RegExp(command))

    const version = await run(executable, [command, '--version'], {
      cwd: projectRoot,
    })
    assert.equal(version.code, 0, `${command} --version: ${version.stderr}`)
    assert.match(version.stdout, /PostgreSQL.*18\.3/)

    const invalid = await run(
      executable,
      [command, '--definitely-not-a-postgresql-option'],
      { cwd: projectRoot },
    )
    assert.notEqual(invalid.code, 0, `${command} accepted an invalid option`)
    assert.match(invalid.stderr, /unrecognized option|Try .*--help/)
  }
}

async function assertInitdbAuthentication(executable) {
  const dataDir = join(projectRoot, 'auth-pgdata')
  const init = await run(
    executable,
    [
      'initdb',
      '-D',
      dataDir,
      '--auth=reject',
      '--auth-host=scram-sha-256',
      '--auth-local=trust',
      '--username=pglite_owner',
    ],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        USER: 'another-host-user',
        LOGNAME: 'another-host-user',
        PGUSER: 'wrong-database-role',
      },
    },
  )
  assert.equal(init.code, 0, init.stderr)
  const hba = await readFile(join(dataDir, 'pg_hba.conf'), 'utf8')
  assert.match(hba, /^local\s+all\s+all\s+trust$/m)
  assert.match(hba, /^host\s+all\s+all\s+127\.0\.0\.1\/32\s+scram-sha-256$/m)
  assert.match(hba, /^host\s+all\s+all\s+::1\/128\s+scram-sha-256$/m)
}

async function assertProgrammaticImports() {
  const esm = await run(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import { PGlite } from 'pglite'
import { PGlite as ScopedPGlite } from '@electric-sql/pglite'
import { PGlitePostmaster } from 'pglite/postmaster'
import { PGlitePostmaster as ScopedPostmaster } from '@electric-sql/pglite/postmaster'
import { PGliteServer } from 'pglite/server'
import { PGliteServer as ScopedServer } from '@electric-sql/pglite-server'
import * as tools from 'pglite/tools'
import { runPsql, psqlRunner } from '@electric-sql/pglite-tools/psql'
import { runPgRestore, pgRestoreRunner } from '@electric-sql/pglite-tools/pg_restore'
import * as admin from '@electric-sql/pglite-tools/admin'
if (
  PGlite !== ScopedPGlite ||
  PGlitePostmaster !== ScopedPostmaster ||
  PGliteServer !== ScopedServer ||
  tools.runPsql !== runPsql ||
  tools.psqlRunner !== psqlRunner ||
  tools.runPgRestore !== runPgRestore ||
  tools.pgRestoreRunner !== pgRestoreRunner ||
  tools.runCreateDb !== admin.runCreateDb ||
  tools.reindexDbRunner !== admin.reindexDbRunner
) process.exit(9)`,
    ],
    { cwd: projectRoot },
  )
  assert.equal(esm.code, 0, esm.stderr)
  const commonjs = await run(
    process.execPath,
    [
      '-e',
      `const { PGlite } = require('pglite')
const { PGlite: ScopedPGlite } = require('@electric-sql/pglite')
const { PGlitePostmaster } = require('pglite/postmaster')
const { PGlitePostmaster: ScopedPostmaster } = require('@electric-sql/pglite/postmaster')
const { PGliteServer } = require('pglite/server')
const { PGliteServer: ScopedServer } = require('@electric-sql/pglite-server')
const tools = require('pglite/tools')
const { runPsql, psqlRunner } = require('@electric-sql/pglite-tools/psql')
const { runPgRestore, pgRestoreRunner } = require('@electric-sql/pglite-tools/pg_restore')
const admin = require('@electric-sql/pglite-tools/admin')
if (
  PGlite !== ScopedPGlite ||
  PGlitePostmaster !== ScopedPostmaster ||
  PGliteServer !== ScopedServer ||
  tools.runPsql !== runPsql ||
  tools.psqlRunner !== psqlRunner ||
  tools.runPgRestore !== runPgRestore ||
  tools.pgRestoreRunner !== pgRestoreRunner ||
  tools.runCreateDb !== admin.runCreateDb ||
  tools.reindexDbRunner !== admin.reindexDbRunner
) process.exit(9)`,
    ],
    { cwd: projectRoot },
  )
  assert.equal(commonjs.code, 0, commonjs.stderr)
}

async function assertNpxTarball() {
  const packages = await Promise.all(
    [
      ['@electric-sql/pglite', '0.5.4'],
      ['@electric-sql/pglite-server', '0.1.0'],
      ['@electric-sql/pglite-tools', '0.4.4'],
    ].map(async ([name, version]) => {
      const manifest = JSON.parse(
        await readFile(
          join(projectRoot, 'node_modules', name, 'package.json'),
          'utf8',
        ),
      )
      const archiveName = `${name.replace('@', '').replace('/', '-')}-${version}.tgz`
      await access(join(packRoot, archiveName))
      const archive = await readFile(join(packRoot, archiveName))
      return { name, version, manifest, archiveName, archive }
    }),
  )
  const registry = createHttpServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://registry').pathname
    const tarball = packages.find(
      (entry) => pathname === `/tarballs/${entry.archiveName}`,
    )
    if (tarball) {
      response.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': tarball.archive.length,
      })
      createReadStream(join(packRoot, tarball.archiveName)).pipe(response)
      return
    }
    const requestedName = decodeURIComponent(pathname.slice(1))
    const entry = packages.find(({ name }) => name === requestedName)
    if (!entry) {
      response.writeHead(302, {
        location: `https://registry.npmjs.org${request.url ?? '/'}`,
      })
      response.end()
      return
    }
    const address = registry.address()
    assert.ok(address && typeof address === 'object')
    const body = JSON.stringify({
      name: entry.name,
      'dist-tags': { latest: entry.version },
      versions: {
        [entry.version]: {
          ...entry.manifest,
          dist: {
            tarball: `http://127.0.0.1:${address.port}/tarballs/${entry.archiveName}`,
            shasum: createHash('sha1').update(entry.archive).digest('hex'),
            integrity: `sha512-${createHash('sha512').update(entry.archive).digest('base64')}`,
          },
        },
      },
    })
    response.writeHead(200, {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body),
    })
    response.end(body)
  })
  await new Promise((resolve, reject) => {
    registry.once('error', reject)
    registry.listen(0, '127.0.0.1', resolve)
  })
  try {
    const address = registry.address()
    assert.ok(address && typeof address === 'object')
    const npxProject = join(outputRoot, 'npx-project')
    await mkdir(npxProject, { recursive: true })
    const cliArchive = (await readdir(packRoot)).find((name) =>
      /^pglite-[^-]+\.tgz$/.test(name),
    )
    assert.ok(cliArchive)
    const npxEnvironment = {
      ...process.env,
      npm_config_registry: `http://127.0.0.1:${address.port}/`,
      npm_config_cache: join(outputRoot, 'npm-cache'),
      npm_config_audit: 'false',
      npm_config_fund: 'false',
    }
    const npxArguments = [
      '--yes',
      `--package=${join(packRoot, cliArchive)}`,
      'pglite',
    ]
    const help = await run('npx', [...npxArguments, '--help'], {
      cwd: npxProject,
      env: npxEnvironment,
    })
    assert.equal(help.code, 0, help.stderr)
    assert.match(help.stdout, /Usage: pglite/)

    const npxDataDirectory = join(npxProject, 'pgdata')
    const init = await run(
      'npx',
      [...npxArguments, 'initdb', '-D', npxDataDirectory],
      { cwd: npxProject, env: npxEnvironment },
    )
    assert.equal(init.code, 0, init.stderr)
    assert.match(
      await readFile(join(npxDataDirectory, 'PG_VERSION'), 'utf8'),
      /^18/,
    )
    await assertNpxPostgres(
      npxArguments,
      npxProject,
      npxDataDirectory,
      npxEnvironment,
    )
  } finally {
    await new Promise((resolve, reject) =>
      registry.close((error) => (error ? reject(error) : resolve())),
    )
  }
}

async function assertNpxPostgres(
  npxArguments,
  npxProject,
  npxDataDirectory,
  npxEnvironment,
) {
  const port = await reservePort()
  const environment = {
    ...npxEnvironment,
    PGHOST: '127.0.0.1',
    PGPORT: String(port),
    PGDATABASE: 'postgres',
    PGUSER: 'postgres',
    PGSSLMODE: 'disable',
  }
  const child = spawn(
    'npx',
    [
      ...npxArguments,
      'postgres',
      '-D',
      npxDataDirectory,
      '-c',
      'listen_addresses=127.0.0.1',
      '-c',
      `port=${port}`,
      '-c',
      'unix_socket_directories=',
    ],
    {
      cwd: npxProject,
      env: environment,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  const output = collectOutput(child)
  let operationError
  try {
    const ready = await waitForSuccess(
      () =>
        run(
          psql,
          ['-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', 'SELECT 42'],
          {
            cwd: npxProject,
            env: { ...environment, LD_LIBRARY_PATH: libraryPath },
          },
        ),
      60_000,
    )
    assert.match(ready.stdout, /^42$/m)
    process.kill(-child.pid, 'SIGTERM')
    await childExit(child, 30_000)
    await waitForMissing(join(npxDataDirectory, 'postmaster.pid'), 30_000)
  } catch (error) {
    operationError = error
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      try {
        process.kill(-child.pid, 'SIGQUIT')
      } catch (error) {
        if (error?.code !== 'ESRCH') operationError ??= error
      }
      await childExit(child, 15_000).catch(() => undefined)
    }
  }
  if (operationError) throw operationError
  if (child.exitCode && child.exitCode !== 0) {
    throw new Error(`npx postgres failed\n${output.stderr()}`)
  }
}

async function assertExplicitServer(executable, dataDir) {
  const port = await reservePort()
  const environment = {
    ...process.env,
    PGHOST: '127.0.0.1',
    PGPORT: String(port),
    PGDATABASE: 'postgres',
    PGUSER: 'postgres',
    PGSSLMODE: 'disable',
  }
  const child = spawn(
    executable,
    [
      'server',
      '-D',
      dataDir,
      '--host=127.0.0.1',
      `--port=${port}`,
      '--max-connections=4',
      '--shared-buffers=16MB',
    ],
    {
      cwd: projectRoot,
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  const output = collectOutput(child)
  let operationError
  try {
    const ready = await waitForSuccess(
      () =>
        run(
          psql,
          ['-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', 'SELECT 12 * 7'],
          {
            cwd: projectRoot,
            env: { ...environment, LD_LIBRARY_PATH: libraryPath },
          },
        ),
      60_000,
    )
    assert.match(ready.stdout, /^84$/m)
    child.kill('SIGINT')
    const exit = await childExit(child, 30_000)
    assert.equal(exit.code, 0, output.stderr())
    await waitForMissing(join(dataDir, 'postmaster.pid'), 30_000)
  } catch (error) {
    operationError = error
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGQUIT')
      await childExit(child, 15_000).catch(() => undefined)
    }
  }
  if (operationError) throw operationError
}

async function waitUntilReady(executable, environment, output) {
  const result = await waitForSuccess(async () => {
    if (postgres.exitCode !== null || postgres.signalCode !== null) {
      throw new Error(`postgres exited early\n${output.stderr()}`)
    }
    return run(executable, ['pg_isready'], {
      cwd: projectRoot,
      env: environment,
    })
  }, 60_000)
  assert.match(result.stdout, /accepting connections/)
}

async function waitForSuccess(operation, timeout) {
  const deadline = Date.now() + timeout
  let last
  while (Date.now() < deadline) {
    last = await operation()
    if (last.code === 0) return last
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`operation did not succeed: ${last?.stderr ?? 'no result'}`)
}

async function waitForMissing(path, timeout) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    try {
      await access(path)
    } catch {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`${path} was not removed`)
}

function collectOutput(child) {
  const stdout = []
  const stderr = []
  child.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk)))
  child.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)))
  return {
    stdout: () => Buffer.concat(stdout).toString('utf8'),
    stderr: () => Buffer.concat(stderr).toString('utf8'),
  }
}

function childExit(child, timeout) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode })
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('child exit timed out')),
      timeout,
    )
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      resolve({ code, signal })
    })
  })
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: [options.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    })
    const output = collectOutput(child)
    if (options.input !== undefined) child.stdin.end(options.input)
    child.once('error', reject)
    child.once('exit', (code, signal) =>
      resolve({
        code,
        signal,
        stdout: output.stdout(),
        stderr: output.stderr(),
      }),
    )
  })
}

async function reservePort() {
  const server = createNetServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
  return address.port
}
