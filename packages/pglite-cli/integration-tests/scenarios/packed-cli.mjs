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
let postgres

try {
  await rm(outputRoot, { recursive: true, force: true })
  await mkdir(packRoot, { recursive: true })
  await mkdir(projectRoot, { recursive: true })
  await packPackages()
  await installPackages()

  const executable = join(projectRoot, 'node_modules/.bin/pglite')
  await access(executable)

  await assertNpxTarball()

  await assertProgrammaticImports()

  const init = await run(executable, ['initdb', '-D', dataDirectory], {
    cwd: projectRoot,
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

async function assertProgrammaticImports() {
  const esm = await run(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "import { PGlite } from 'pglite'; import { PGlite as ScopedPGlite } from '@electric-sql/pglite'; import { PGlitePostmaster } from 'pglite/postmaster'; import { PGlitePostmaster as ScopedPostmaster } from '@electric-sql/pglite/postmaster'; import { PGliteServer } from 'pglite/server'; import { PGliteServer as ScopedServer } from '@electric-sql/pglite-server'; if (PGlite !== ScopedPGlite || PGlitePostmaster !== ScopedPostmaster || PGliteServer !== ScopedServer) process.exit(9)",
    ],
    { cwd: projectRoot },
  )
  assert.equal(esm.code, 0, esm.stderr)
  const commonjs = await run(
    process.execPath,
    [
      '-e',
      "const { PGlite } = require('pglite'); const { PGlite: ScopedPGlite } = require('@electric-sql/pglite'); const { PGlitePostmaster } = require('pglite/postmaster'); const { PGlitePostmaster: ScopedPostmaster } = require('@electric-sql/pglite/postmaster'); const { PGliteServer } = require('pglite/server'); const { PGliteServer: ScopedServer } = require('@electric-sql/pglite-server'); if (PGlite !== ScopedPGlite || PGlitePostmaster !== ScopedPostmaster || PGliteServer !== ScopedServer) process.exit(9)",
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
    const help = await run(
      'npx',
      ['--yes', `--package=${join(packRoot, cliArchive)}`, 'pglite', '--help'],
      {
        cwd: npxProject,
        env: {
          ...process.env,
          npm_config_registry: `http://127.0.0.1:${address.port}/`,
          npm_config_cache: join(outputRoot, 'npm-cache'),
          npm_config_audit: 'false',
          npm_config_fund: 'false',
        },
      },
    )
    assert.equal(help.code, 0, help.stderr)
    assert.match(help.stdout, /Usage: pglite/)
  } finally {
    await new Promise((resolve, reject) =>
      registry.close((error) => (error ? reject(error) : resolve())),
    )
  }
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
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const output = collectOutput(child)
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
