#!/usr/bin/env node

import assert from 'node:assert/strict'
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  realpathSync,
  statSync,
} from 'node:fs'
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { userInfo } from 'node:os'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { createConnection } from 'node:net'
import { fileURLToPath } from 'node:url'

const PROVIDER_SCHEMA = 1
const STATE_FILE = '.pglite-provider.json'
const CLUSTER_FILE = '.pglite-provider-cluster.json'
const VERSION = '18.3'
const [command, ...commandArgs] = process.argv.slice(2)

if (!command) fail('provider command is required')

const providerRoot = resolve(
  process.env.PGLITE_TEST_PROVIDER ??
    join(dirname(fileURLToPath(import.meta.url)), '..'),
)
const config = JSON.parse(
  await readFile(join(providerRoot, 'config.json'), 'utf8'),
)
validateConfig(config)

try {
  if (command === 'initdb') await runInitdb(commandArgs)
  else if (command === 'postgres') await runPostgres(commandArgs)
  else if (command === 'pg_ctl') await runPgCtl(commandArgs)
  else fail(`unsupported provider command: ${command}`)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}

async function runInitdb(args) {
  if (printVersionOrHelp('initdb', args)) return
  const parsed = parseInitdb(args)
  const pgdata = canonicalDataDirectory(parsed.pgdata)
  if (existsSync(join(pgdata, 'PG_VERSION'))) {
    fail(`initdb: directory already contains a database system: ${pgdata}`)
  }
  const modes = dataDirectoryModes(
    parsed.initdbArgs.includes('--allow-group-access'),
  )
  const previousUmask = process.umask(modes.umask)
  await mkdir(pgdata, { recursive: true, mode: modes.directory })
  await chmod(pgdata, modes.directory)

  try {
    const status = await spawnAndWait(
      config.cliExecutable,
      [
        'initdb',
        '-D',
        pgdata,
        // PostgreSQL's native initdb default is sized for a host server. A
        // Wasm postmaster keeps the buffer pool in its shared linear memory;
        // use PGlite's compact test-provider baseline unless the invoking
        // suite supplies a later -c assignment of its own.
        '-c',
        'shared_buffers=16MB',
        ...parsed.initdbArgs,
      ],
      {
        env: {
          ...process.env,
          PGDATA: pgdata,
          PGUSER: parsed.username,
          PGLITE_CONFIG: config.cliConfigModule,
        },
        stdio: 'inherit',
      },
    )
    if (status !== 0) {
      fail(`initdb: packed pglite CLI exited with status ${status}`)
    }
    if (!existsSync(join(pgdata, 'PG_VERSION'))) {
      fail(`initdb: packed pglite CLI did not initialize ${pgdata}`)
    }
    await writeFile(
      join(pgdata, CLUSTER_FILE),
      `${JSON.stringify(
        {
          schema: PROVIDER_SCHEMA,
          bootstrapSuperuser: parsed.username,
        },
        null,
        2,
      )}\n`,
      { mode: modes.file },
    )
  } finally {
    process.umask(previousUmask)
  }
}

async function runPostgres(args) {
  if (printVersionOrHelp('postgres', args)) return
  const parsed = parsePostgres(args)
  if (parsed.describeSetting && !parsed.pgdata) {
    runPostgresDescribe(undefined, parsed)
    return
  }
  const pgdata = canonicalDataDirectory(parsed.pgdata)
  if (!existsSync(join(pgdata, 'PG_VERSION'))) {
    fail(`postgres: data directory is not initialized: ${pgdata}`)
  }
  if (parsed.describeSetting) {
    runPostgresDescribe(pgdata, parsed)
    return
  }
  process.umask(dataDirectoryModesForPath(pgdata).umask)
  await removeStaleLifecycle(pgdata)

  const fileSettings = readPostgresqlSettings(join(pgdata, 'postgresql.conf'))
  const setting = (name, fallback) =>
    parsed.settings.get(name) ?? fileSettings.get(name) ?? fallback
  const port = parsePort(setting('port', process.env.PGPORT ?? '5432'))
  const socketDirectories = splitSettingList(
    setting('unix_socket_directories', ''),
  )
  const listenAddresses = splitSettingList(
    setting('listen_addresses', '127.0.0.1'),
  )
  const address = socketDirectories.length
    ? {
        transport: 'unix',
        directory: socketDirectories[0],
        path: join(socketDirectories[0], `.s.PGSQL.${port}`),
        port,
      }
    : {
        transport: 'tcp',
        host: listenAddresses.find(Boolean) ?? '127.0.0.1',
        port,
      }
  const configuredConnections = Number.parseInt(
    setting('max_connections', '100'),
    10,
  )
  const maxConnections = Math.max(
    32,
    Number.isInteger(configuredConnections) ? configuredConnections : 100,
  )
  const cluster = await readClusterMetadata(pgdata)
  const startedAt = Date.now()
  const child = spawn(
    config.cliExecutable,
    ['postgres', '-D', pgdata, ...parsed.startParams, '-p', String(port)],
    {
      env: {
        ...process.env,
        PGDATA: pgdata,
        PGLITE_CONFIG: config.cliConfigModule,
        PGLITE_PROVIDER_OS_USER: cluster.bootstrapSuperuser,
        PGLITE_MAX_SESSIONS: String(maxConnections),
        PGLITE_PRIVATE_MEMORY_LIMIT: String(config.privateMaximumMemory),
        PGLITE_GLOBAL_MEMORY_LIMIT: String(config.globalMaximumMemory),
        PGLITE_LOG_LEVEL:
          process.env.PGLITE_PROVIDER_DEBUG === 'true' ? 'debug' : 'off',
      },
      stdio: 'inherit',
    },
  )
  let shutdownSignal
  const handlers = new Map()
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGQUIT', 'SIGHUP']) {
    const handler = () => {
      if (signal !== 'SIGHUP') shutdownSignal ??= signal
      if (child.exitCode === null && child.signalCode === null) {
        const forwarded = child.kill(signal)
        if (process.env.PGLITE_PROVIDER_DEBUG === 'true') {
          console.error(
            `provider: forwarded ${signal} to packed CLI ${child.pid}: ${forwarded}`,
          )
        }
      }
    }
    handlers.set(signal, handler)
    process.on(signal, handler)
  }
  let status = 'pass'
  let reason = 'requested-shutdown'
  let cliExit
  try {
    await waitForCliReady(child, pgdata)
    await waitForListeningAddress(child, address)
    await writeLifecycle(pgdata, {
      schema: PROVIDER_SCHEMA,
      status: 'ready',
      providerRevision: config.postgresRevision,
      pid: process.pid,
      pgdata,
      address,
      startedAt: new Date(startedAt).toISOString(),
      serverArgs: parsed.serverArgs,
    })
    cliExit = await childResult(child)
    if (!shutdownSignal || cliExit.code !== 0) {
      status = 'fail'
      reason = shutdownSignal ? 'shutdown-failed' : 'unexpected-cli-exit'
    }
  } catch (error) {
    status = 'fail'
    reason = 'provider-error'
    console.error(error)
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGQUIT')
      cliExit = await childResult(child).catch(() => undefined)
    }
    for (const [signal, handler] of handlers) process.off(signal, handler)
    const result = {
      schema: PROVIDER_SCHEMA,
      status,
      reason,
      pid: process.pid,
      pgdata,
      elapsedMs: Date.now() - startedAt,
      cliExecutable: config.cliExecutable,
      cliExit,
    }
    await writeClusterResult(result)
    await rm(join(pgdata, STATE_FILE), { force: true })
  }
  if (status !== 'pass') process.exitCode = 1
}

async function waitForListeningAddress(child, address) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      fail('provider: packed CLI exited before its listener became ready')
    }
    if (
      address.transport === 'unix'
        ? existsSync(address.path)
        : await canConnect(address.host, address.port)
    ) {
      return
    }
    await delay(50)
  }
  fail('provider: packed CLI listener did not become ready within 30 seconds')
}

function canConnect(host, port) {
  return new Promise((resolveConnection) => {
    const socket = createConnection({ host, port })
    const finish = (connected) => {
      socket.removeAllListeners()
      socket.destroy()
      resolveConnection(connected)
    }
    socket.setTimeout(250, () => finish(false))
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
  })
}

async function runPgCtl(args) {
  if (printVersionOrHelp('pg_ctl', args)) return
  const parsed = parsePgCtl(args)
  const pgdata = canonicalDataDirectory(parsed.pgdata)
  if (parsed.action === 'initdb') {
    await runInitdb([
      '--pgdata',
      pgdata,
      ...splitShellWords(parsed.options ?? ''),
    ])
    return
  }
  if (parsed.action === 'start') {
    await startServer(pgdata, parsed)
    return
  }
  if (parsed.action === 'restart') {
    const previous = await readLifecycle(pgdata, false)
    const serverArgs = parsed.options || previous?.serverArgs || []
    const log = parsed.log ?? previous?.log
    await stopServer(pgdata, parsed.mode, parsed.timeout, false, true)
    await startServer(pgdata, { ...parsed, log, options: serverArgs })
    return
  }
  if (parsed.action === 'stop') {
    await stopServer(pgdata, parsed.mode, parsed.timeout, parsed.silent)
    return
  }
  if (parsed.action === 'status') {
    if (!existsSync(pgdata)) {
      console.log(`pg_ctl: directory ${pgdata} does not exist`)
      process.exitCode = 4
      return
    }
    const state = await readLifecycle(pgdata, false)
    if (state && isProcessAlive(state.pid)) {
      console.log(`pg_ctl: server is running (PID: ${state.pid})`)
      return
    }
    console.log('pg_ctl: no server running')
    process.exitCode = 3
    return
  }
  if (parsed.action === 'reload') {
    const state = await requireLiveLifecycle(pgdata)
    process.kill(state.pid, 'SIGHUP')
    return
  }
  fail(`pg_ctl: action is not supported by PGlite provider: ${parsed.action}`)
}

async function startServer(pgdata, options) {
  await removeStaleLifecycle(pgdata)
  const current = await readLifecycle(pgdata, false)
  if (current && isProcessAlive(current.pid)) {
    fail(`pg_ctl: another server is already running for ${pgdata}`)
  }
  const serverArgs = Array.isArray(options.options)
    ? options.options
    : splitShellWords(options.options ?? '')
  const args = ['-D', pgdata, ...serverArgs]
  const logPath = options.log ? resolve(options.log) : undefined
  let output = 'inherit'
  let logDescriptor
  const previousUmask = process.umask(dataDirectoryModesForPath(pgdata).umask)
  let child
  try {
    if (logPath) {
      await mkdir(dirname(logPath), { recursive: true })
      logDescriptor = openSync(logPath, 'a')
      output = logDescriptor
    }
    child = spawn(join(providerRoot, 'bin', 'postgres'), args, {
      env: { ...process.env, PGLITE_TEST_PROVIDER: providerRoot },
      detached: false,
      stdio: ['ignore', output, output],
    })
  } finally {
    process.umask(previousUmask)
  }
  let spawnError
  child.once('error', (error) => {
    spawnError = error
  })
  if (logDescriptor !== undefined) closeSync(logDescriptor)
  const deadline = Date.now() + options.timeout * 1_000
  try {
    while (Date.now() < deadline) {
      const state = await readLifecycle(pgdata, false)
      if (state?.status === 'ready' && state.pid === child.pid) {
        if (logPath) {
          state.log = logPath
          await writeLifecycle(pgdata, state)
        }
        child.unref()
        if (!options.silent) {
          console.log('waiting for server to start.... done')
          console.log('server started')
        }
        return
      }
      if (
        spawnError ||
        child.exitCode !== null ||
        child.signalCode !== null ||
        !isProcessAlive(child.pid)
      ) {
        fail(
          `pg_ctl: could not start server: process exited before becoming ready${spawnError ? `: ${spawnError.message}` : `; see ${logPath ?? 'stderr'}`}`,
        )
      }
      await delay(100)
    }
    fail(
      `pg_ctl: server did not become ready within ${options.timeout} seconds`,
    )
  } catch (error) {
    await terminateStartingServer(child, pgdata)
    throw error
  }
}

async function terminateStartingServer(child, pgdata) {
  if (isProcessAlive(child.pid)) {
    try {
      process.kill(child.pid, 'SIGQUIT')
    } catch (error) {
      if (error?.code !== 'ESRCH') throw error
    }
  }
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline && isProcessAlive(child.pid)) await delay(50)
  if (isProcessAlive(child.pid)) {
    try {
      process.kill(child.pid, 'SIGKILL')
    } catch (error) {
      if (error?.code !== 'ESRCH') throw error
    }
  }
  await rm(join(pgdata, STATE_FILE), { force: true })
}

async function stopServer(
  pgdata,
  mode,
  timeout,
  silent,
  allowNotRunning = false,
) {
  const state = await readLifecycle(pgdata, false)
  if (!state || !isProcessAlive(state.pid)) {
    if (allowNotRunning) return
    if (!silent)
      console.error('pg_ctl: PID file does not exist or server is not running')
    process.exitCode = 1
    return
  }
  const signal =
    mode === 'smart' ? 'SIGTERM' : mode === 'fast' ? 'SIGINT' : 'SIGQUIT'
  process.kill(state.pid, signal)
  const deadline = Date.now() + timeout * 1_000
  while (Date.now() < deadline) {
    const lifecycle = await readLifecycle(pgdata, false)
    // The foreground provider removes lifecycle state only after the
    // postmaster, Workers, socket frontend, and result write have completed.
    // Its PID can remain observable as a zombie until pg_regress reaps it;
    // requiring kill(pid, 0) to fail here deadlocks that reap behind pg_ctl.
    if (!lifecycle) return
    if (!isProcessAlive(state.pid)) {
      await rm(join(pgdata, STATE_FILE), { force: true })
      return
    }
    await delay(100)
  }
  fail(`pg_ctl: server did not shut down within ${timeout} seconds`)
}

function parseInitdb(args) {
  let pgdata
  let username
  const initdbArgs = []
  const valueOptions = new Set([
    '-E',
    '--encoding',
    '--locale',
    '--locale-provider',
    '--icu-locale',
    '--icu-rules',
    '--lc-collate',
    '--lc-ctype',
    '--lc-messages',
    '--lc-monetary',
    '--lc-numeric',
    '--lc-time',
    '-U',
    '--username',
    '-A',
    '--auth',
    '--auth-local',
    '--auth-host',
    '-c',
    '--set',
  ])
  const flagOptions = new Set([
    '--allow-group-access',
    '--data-checksums',
    '--no-data-checksums',
    '--debug',
    '--no-clean',
    '--no-instructions',
    '--no-locale',
    '--no-sync',
  ])
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '-D' || arg === '--pgdata') {
      pgdata = requiredValue(args, ++i, arg)
    } else if (arg.startsWith('--pgdata=')) {
      pgdata = arg.slice('--pgdata='.length)
    } else if (valueOptions.has(arg)) {
      const value = requiredValue(args, ++i, arg)
      initdbArgs.push(arg, value)
      if (arg === '-U' || arg === '--username') username = value
    } else if (
      [...valueOptions].some(
        (name) => name.startsWith('--') && arg.startsWith(`${name}=`),
      )
    ) {
      initdbArgs.push(arg)
      if (arg.startsWith('--username=')) {
        username = arg.slice('--username='.length)
      }
    } else if (flagOptions.has(arg)) {
      initdbArgs.push(arg)
    } else if (
      arg === '--waldir' ||
      arg.startsWith('--waldir=') ||
      arg === '--pwfile' ||
      arg.startsWith('--pwfile=')
    ) {
      fail(
        `initdb: option requires an unimplemented host-path capability: ${arg}`,
      )
    } else if (!arg.startsWith('-') && pgdata === undefined) {
      pgdata = arg
    } else {
      fail(`initdb: unsupported option: ${arg}`)
    }
  }
  if (!pgdata) fail('initdb: data directory must be specified with -D/--pgdata')
  // Native initdb defaults the bootstrap superuser to the invoking OS user.
  // PGlite otherwise defaults to "postgres", which makes pg_regress connect
  // as the container user to a role that does not exist.
  if (!username) {
    username = process.env.USER || process.env.LOGNAME || userInfo().username
    initdbArgs.push('-U', username)
  }
  return { pgdata, initdbArgs, username }
}

function parsePostgres(args) {
  let pgdata
  let describeSetting
  const startParams = []
  const serverArgs = []
  const settings = new Map()
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '-D' || arg === '--data-directory') {
      pgdata = requiredValue(args, ++i, arg)
    } else if (arg.startsWith('--data-directory=')) {
      pgdata = arg.slice('--data-directory='.length)
    } else if (arg === '-c') {
      const value = requiredValue(args, ++i, arg)
      startParams.push('-c', value)
      serverArgs.push('-c', value)
      recordSetting(settings, value)
    } else if (arg === '-C') {
      if (describeSetting !== undefined) {
        fail('postgres: -C may only be specified once')
      }
      describeSetting = requiredValue(args, ++i, arg)
    } else if (arg === '-k' || arg === '-p' || arg === '-h') {
      const value = requiredValue(args, ++i, arg)
      startParams.push(arg, value)
      serverArgs.push(arg, value)
      settings.set(
        arg === '-k'
          ? 'unix_socket_directories'
          : arg === '-p'
            ? 'port'
            : 'listen_addresses',
        value,
      )
    } else if (arg === '-F') {
      startParams.push(arg)
      serverArgs.push(arg)
    } else if (arg === '-d') {
      const value = requiredValue(args, ++i, arg)
      startParams.push(arg, value)
      serverArgs.push(arg, value)
    } else if (arg.startsWith('--') && arg.includes('=')) {
      startParams.push(arg)
      serverArgs.push(arg)
      recordSetting(settings, arg.slice(2))
    } else {
      fail(`postgres: unsupported provider option: ${arg}`)
    }
  }
  if (!pgdata && describeSetting === undefined) {
    fail('postgres: data directory must be specified with -D')
  }
  return { pgdata, describeSetting, startParams, serverArgs, settings }
}

function runPostgresDescribe(pgdata, parsed) {
  // `postgres -C` is an offline, read-only configuration query rather than
  // server execution.  data_checksums is runtime-computed from pg_control, so
  // query it with the exact pg_controldata revision built by the regression
  // harness.  This keeps control-file parsing out of the provider while normal
  // postgres invocations continue to run exclusively through PGlitePostmaster.
  const name = parsed.describeSetting.toLowerCase().replaceAll('-', '_')
  if (name !== 'data_checksums') {
    const executable = config.postgresExecutable
    if (!existsSync(executable)) {
      fail(`postgres: exact-revision executable is missing: ${executable}`)
    }
    const args = [
      ...(pgdata ? ['-D', pgdata] : []),
      '-C',
      parsed.describeSetting,
      ...parsed.serverArgs,
    ]
    const result = spawnSync(executable, args, {
      env: process.env,
      stdio: 'inherit',
    })
    if (result.error) throw result.error
    if (result.signal) {
      fail(`postgres: exact-revision -C probe terminated by ${result.signal}`)
    }
    process.exitCode = result.status ?? 1
    return
  }
  if (!pgdata) {
    fail('postgres: data_checksums requires a data directory')
  }
  const executable = join(
    config.postgresBuild,
    'src/bin/pg_controldata/pg_controldata',
  )
  if (!existsSync(executable)) {
    fail(`postgres: pg_controldata is missing: ${executable}`)
  }
  const output = execFileSync(executable, [pgdata], {
    encoding: 'utf8',
    env: process.env,
  })
  const match = /^Data page checksum version:\s*(\d+)\s*$/m.exec(output)
  if (!match) {
    fail('postgres: pg_controldata did not report a checksum version')
  }
  console.log(Number.parseInt(match[1], 10) === 0 ? 'off' : 'on')
}

function parsePgCtl(args) {
  let pgdata
  let action
  let mode = 'fast'
  let timeout = Number.parseInt(process.env.PGCTLTIMEOUT ?? '60', 10)
  let log
  let options = ''
  let silent = false
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '-D' || arg === '--pgdata') {
      pgdata = requiredValue(args, ++i, arg)
    } else if (arg.startsWith('--pgdata=')) {
      pgdata = arg.slice('--pgdata='.length)
    } else if (arg === '-m' || arg === '--mode') {
      mode = requiredValue(args, ++i, arg)
    } else if (arg.startsWith('--mode=')) {
      mode = arg.slice('--mode='.length)
    } else if (arg === '-t' || arg === '--timeout') {
      timeout = Number.parseInt(requiredValue(args, ++i, arg), 10)
    } else if (arg.startsWith('--timeout=')) {
      timeout = Number.parseInt(arg.slice('--timeout='.length), 10)
    } else if (arg === '-l' || arg === '--log') {
      log = requiredValue(args, ++i, arg)
    } else if (arg.startsWith('--log=')) {
      log = arg.slice('--log='.length)
    } else if (arg === '-o' || arg === '--options') {
      options = requiredValue(args, ++i, arg)
    } else if (arg.startsWith('--options=')) {
      options = arg.slice('--options='.length)
    } else if (arg === '-s' || arg === '--silent') {
      silent = true
    } else if (
      arg === '-w' ||
      arg === '--wait' ||
      arg === '-W' ||
      arg === '--no-wait'
    ) {
      // The provider always waits: its lifecycle state is the synchronization contract.
    } else if (!arg.startsWith('-') && action === undefined) {
      action = arg
    } else {
      fail(`pg_ctl: unsupported provider option: ${arg}`)
    }
  }
  if (!pgdata) fail('pg_ctl: data directory must be specified with -D/--pgdata')
  if (!action) fail('pg_ctl: action is required')
  if (!['smart', 'fast', 'immediate'].includes(mode)) {
    fail(`pg_ctl: unsupported shutdown mode: ${mode}`)
  }
  if (!Number.isInteger(timeout) || timeout <= 0) {
    fail(`pg_ctl: invalid timeout: ${timeout}`)
  }
  return { pgdata, action, mode, timeout, log, options, silent }
}

function readPostgresqlSettings(path) {
  const settings = new Map()
  if (!existsSync(path)) return settings
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const withoutComment = stripConfigComment(line).trim()
    const match = /^([A-Za-z_][A-Za-z0-9_.]*)\s*=\s*(.*?)\s*$/.exec(
      withoutComment,
    )
    if (!match) continue
    settings.set(match[1].toLowerCase(), unquoteSetting(match[2]))
  }
  return settings
}

function stripConfigComment(line) {
  let quote = false
  for (let index = 0; index < line.length; index++) {
    if (line[index] === "'" && line[index - 1] !== '\\') quote = !quote
    if (line[index] === '#' && !quote) return line.slice(0, index)
  }
  return line
}

function unquoteSetting(value) {
  const trimmed = value.trim()
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replaceAll("''", "'")
  }
  return trimmed
}

function splitSettingList(value) {
  return unquoteSetting(String(value))
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function recordSetting(settings, assignment) {
  const separator = assignment.indexOf('=')
  if (separator <= 0) fail(`postgres: invalid setting: ${assignment}`)
  settings.set(
    assignment.slice(0, separator).trim().toLowerCase().replaceAll('-', '_'),
    unquoteSetting(assignment.slice(separator + 1)),
  )
}

function splitShellWords(text) {
  const result = []
  let value = ''
  let quote
  let escaped = false
  for (const char of text) {
    if (escaped) {
      value += char
      escaped = false
    } else if (char === '\\' && quote !== "'") {
      escaped = true
    } else if ((char === "'" || char === '"') && (!quote || quote === char)) {
      quote = quote ? undefined : char
    } else if (/\s/.test(char) && !quote) {
      if (value) result.push(value)
      value = ''
    } else {
      value += char
    }
  }
  if (quote || escaped) fail(`pg_ctl: malformed --options value: ${text}`)
  if (value) result.push(value)
  return result
}

async function removeStaleLifecycle(pgdata) {
  // Physical backups and filesystem clones can copy the provider's runtime
  // marker.  Unlike CLUSTER_FILE, this file describes one running host
  // process and must not be inherited by another data-directory path.  Drop
  // that foreign marker before considering whether its PID is live: it may
  // legitimately still identify the source cluster.
  const statePath = join(pgdata, STATE_FILE)
  if (existsSync(statePath)) {
    const copiedState = JSON.parse(await readFile(statePath, 'utf8'))
    if (copiedState.pgdata !== pgdata) {
      await rm(statePath, { force: true })
    }
  }
  const state = await readLifecycle(pgdata, false)
  if (state && isProcessAlive(state.pid)) {
    fail(`provider: live server ${state.pid} already owns ${pgdata}`)
  }
  if (state) await rm(join(pgdata, STATE_FILE), { force: true })
  const pidPath = join(pgdata, 'postmaster.pid')
  if (existsSync(pidPath)) {
    const pid = Number.parseInt(
      readFileSync(pidPath, 'utf8').split(/\r?\n/, 1)[0],
      10,
    )
    if (Number.isInteger(pid) && isProcessAlive(pid)) {
      fail(`provider: live postmaster PID ${pid} already owns ${pgdata}`)
    }
    await rm(pidPath, { force: true })
  }
}

async function requireLiveLifecycle(pgdata) {
  const state = await readLifecycle(pgdata, true)
  if (!isProcessAlive(state.pid))
    fail(`provider: server PID ${state.pid} is not running`)
  return state
}

async function readLifecycle(pgdata, required) {
  const path = join(pgdata, STATE_FILE)
  try {
    const state = JSON.parse(await readFile(path, 'utf8'))
    if (
      state.schema !== PROVIDER_SCHEMA ||
      state.pgdata !== pgdata ||
      !Number.isInteger(state.pid)
    ) {
      fail(`provider: invalid lifecycle state: ${path}`)
    }
    return state
  } catch (error) {
    if (!required && error?.code === 'ENOENT') return undefined
    throw error
  }
}

async function writeLifecycle(pgdata, state) {
  const path = join(pgdata, STATE_FILE)
  const temporary = `${path}.${process.pid}.tmp`
  const mode = dataDirectoryModesForPath(pgdata).file
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, {
    mode,
  })
  await chmod(temporary, mode)
  await rename(temporary, path)
}

function dataDirectoryModesForPath(pgdata) {
  const mode = statSync(pgdata).mode & 0o777
  return dataDirectoryModes((mode & 0o070) !== 0)
}

function dataDirectoryModes(groupAccess) {
  return groupAccess
    ? { directory: 0o750, file: 0o640, umask: 0o027 }
    : { directory: 0o700, file: 0o600, umask: 0o077 }
}

async function readClusterMetadata(pgdata) {
  const path = join(pgdata, CLUSTER_FILE)
  const metadata = JSON.parse(await readFile(path, 'utf8'))
  if (
    metadata.schema !== PROVIDER_SCHEMA ||
    typeof metadata.bootstrapSuperuser !== 'string' ||
    metadata.bootstrapSuperuser.length === 0
  ) {
    fail(`provider: invalid cluster metadata: ${path}`)
  }
  return metadata
}

async function writeClusterResult(result) {
  const directory = join(config.resultsRoot, 'clusters')
  await mkdir(directory, { recursive: true })
  const name = `${basename(result.pgdata).replaceAll(/[^A-Za-z0-9_.-]/g, '_')}-${result.pid}.json`
  await writeFile(join(directory, name), `${JSON.stringify(result, null, 2)}\n`)
}

function canonicalDataDirectory(path) {
  if (!path) fail('provider: PGDATA is required')
  const absolute = resolve(path)
  const parent = realpathSync(dirname(absolute))
  return join(parent, basename(absolute))
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

function printVersionOrHelp(program, args) {
  if (args.length === 1 && ['--version', '-V'].includes(args[0])) {
    console.log(`${program} (PostgreSQL) ${VERSION}`)
    return true
  }
  if (args.length === 1 && ['--help', '-?'].includes(args[0])) {
    console.log(
      `${program} (PostgreSQL) ${VERSION} PGlite test-provider adapter`,
    )
    return true
  }
  return false
}

function parsePort(value) {
  const port = Number.parseInt(value, 10)
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    fail(`provider: invalid PostgreSQL port: ${value}`)
  }
  return port
}

function requiredValue(args, index, option) {
  if (index >= args.length) fail(`${option} requires a value`)
  return args[index]
}

function validateConfig(value) {
  assert.equal(
    value.schema,
    PROVIDER_SCHEMA,
    'unsupported provider config schema',
  )
  assert.equal(
    value.architecture,
    process.arch,
    'provider architecture mismatch',
  )
  for (const path of [
    value.repoRoot,
    value.icuArchive,
    value.workerFilesystemModule,
    value.artifact?.wasm,
    value.artifact?.glue,
    value.artifact?.data,
    value.resultsRoot,
    value.postgresBuild,
    value.postgresExecutable,
    value.cliExecutable,
    value.cliConfigModule,
  ]) {
    assert.equal(typeof path, 'string', 'provider config path is missing')
  }
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))
}

function childResult(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode })
  }
  return new Promise((resolveChild, rejectChild) => {
    child.once('error', rejectChild)
    child.once('exit', (code, signal) => resolveChild({ code, signal }))
  })
}

async function spawnAndWait(executable, args, options = {}) {
  const result = await childResult(spawn(executable, args, options))
  if (result.signal) {
    fail(`${basename(executable)} terminated by ${result.signal}`)
  }
  return result.code ?? 1
}

async function waitForCliReady(child, pgdata) {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `packed pglite CLI exited before becoming ready (status ${child.exitCode}, signal ${child.signalCode})`,
      )
    }
    try {
      // PostgreSQL publishes startup state in the eighth line of
      // postmaster.pid.  This is the same readiness source used by pg_ctl and
      // remains valid when a test deliberately installs an HBA policy that
      // rejects the bootstrap superuser.
      const lines = (await readFile(join(pgdata, 'postmaster.pid'), 'utf8'))
        .trimEnd()
        .split('\n')
      const status = lines[7]?.trim()
      if (status === 'ready' || status === 'standby') return
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    await delay(100)
  }
  throw new Error('packed pglite CLI did not become ready within 60 seconds')
}

function fail(message) {
  throw new Error(message)
}
