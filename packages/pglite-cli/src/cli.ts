import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { pgliteRuntimeIdentity } from '@electric-sql/pglite'
import type {
  PGlitePostmasterExit,
  PGlitePostmasterOptions,
  PGlitePostmasterShutdownMode,
} from '@electric-sql/pglite/postmaster'
import {
  PGliteServer,
  type PGliteServerAddress,
  type PGliteServerOptions,
} from '@electric-sql/pglite-server'
import { initdb, type InitdbOptions } from '@electric-sql/pglite-tools/initdb'
import type { PostgresToolInvocation } from '@electric-sql/pglite-tools/pg_isready'
import {
  nativeToolRunners,
  type NativeToolCommand,
} from '@electric-sql/pglite-tools/_internal/native-tools'
import packageJson from '../package.json'
import type { PGliteNodeConfiguration } from './config.js'

const POSTGRES_TOOL_COMMANDS = [
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
] as const satisfies readonly NativeToolCommand[]

const COMMANDS = [
  'help',
  'version',
  'initdb',
  'server',
  'postgres',
  ...POSTGRES_TOOL_COMMANDS,
] as const

type Command = (typeof COMMANDS)[number]

const GLOBAL_OPTIONS = {
  help: { type: 'boolean', short: '?' },
  version: { type: 'boolean', short: 'V' },
  'pglite-log-level': { type: 'string' },
} as const

const SERVER_OPTIONS = {
  help: { type: 'boolean', short: '?' },
  pgdata: { type: 'string', short: 'D' },
  host: { type: 'string', short: 'h' },
  port: { type: 'string', short: 'p' },
  unix: { type: 'string', short: 'k' },
  'max-connections': { type: 'string' },
  'shared-buffers': { type: 'string' },
  'pglite-max-sessions': { type: 'string' },
  'pglite-private-memory-limit': { type: 'string' },
  'pglite-global-memory-limit': { type: 'string' },
  'pglite-scoped-memory-limit': { type: 'string' },
  'pglite-scoped-memory-mode': { type: 'string' },
  'pglite-log-level': { type: 'string' },
} as const

export interface SignalSource {
  on(signal: NodeJS.Signals, listener: () => void): unknown
  off(signal: NodeJS.Signals, listener: () => void): unknown
}

export interface CliRuntime {
  readonly env: Readonly<Record<string, string | undefined>>
  readonly cwd: string
  readonly stdin: NodeJS.ReadableStream
  readonly stdout: NodeJS.WritableStream
  readonly stderr: NodeJS.WritableStream
  readonly signals: SignalSource
  readonly initdb: (options: InitdbOptions) => Promise<{ exitCode: number }>
  readonly runTool: (
    command: NativeToolCommand,
    invocation: PostgresToolInvocation,
  ) => Promise<number>
  readonly createServer: (options: PGliteServerOptions) => Promise<PGliteServer>
  readonly loadConfiguration: (
    specifier: string,
    cwd: string,
  ) => Promise<unknown>
}

interface GlobalOptions {
  readonly command?: string
  readonly args: readonly string[]
  readonly debug: boolean
}

interface PostmasterRuntimeOptions {
  maxConnections: number
  privateMaximumMemory?: number
  globalMaximumMemory?: number
  scopedMaximumMemory?: number
  scopedMemoryMode?: 'compact' | 'dedicated'
  debug: boolean
}

class CliUsageError extends Error {}

function parseOwnedArguments<T>(operation: () => T): T {
  try {
    return operation()
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      typeof error.code === 'string' &&
      error.code.startsWith('ERR_PARSE_ARGS_')
    ) {
      throw new CliUsageError(error.message)
    }
    throw error
  }
}

export async function runCli(
  argv: readonly string[],
  runtime: CliRuntime = defaultRuntime(),
): Promise<number> {
  try {
    const global = parseGlobalOptions(argv, runtime.env)
    return await dispatch(global, runtime)
  } catch (error) {
    await write(
      runtime.stderr,
      `pglite: ${error instanceof Error ? error.message : String(error)}\n`,
    ).catch(() => undefined)
    return error instanceof CliUsageError ? 2 : 1
  }
}

function defaultRuntime(): CliRuntime {
  return {
    env: process.env,
    cwd: process.cwd(),
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
    signals: process,
    initdb,
    runTool: (command, invocation) =>
      nativeToolRunners[command].run(invocation),
    createServer: (options) => PGliteServer.create(options),
    loadConfiguration: loadConfigurationModule,
  }
}

async function dispatch(
  global: GlobalOptions,
  runtime: CliRuntime,
): Promise<number> {
  const command = global.command
  if (!command) {
    await write(runtime.stdout, mainHelp())
    return 0
  }
  if (!COMMANDS.includes(command as Command)) {
    throw new CliUsageError(
      `unknown command ${JSON.stringify(command)}; run "pglite help"`,
    )
  }
  if (command === 'help') {
    await write(runtime.stdout, commandHelp(global.args[0]))
    return 0
  }
  if (command === 'version') {
    await write(runtime.stdout, versionText())
    return 0
  }
  if (command === 'initdb') return runInitdb(global.args, runtime)
  if (isPostgresToolCommand(command)) {
    return runPostgresTool(command, global.args, runtime)
  }
  if (command === 'server') {
    return runServer(global.args, global.debug, runtime)
  }
  return runPostgres(global.args, global.debug, runtime)
}

function parseGlobalOptions(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): GlobalOptions {
  const boundary = globalCommandBoundary(argv)
  const parsed = parseOwnedArguments(() =>
    parseArgs({
      args: argv.slice(0, boundary.optionsEnd),
      options: GLOBAL_OPTIONS,
      strict: true,
      allowPositionals: false,
      tokens: true,
    }),
  )
  const debug = debugEnabled(
    parsed.values['pglite-log-level'] ?? env.PGLITE_LOG_LEVEL,
  )
  const metaOption = parsed.tokens.find(
    (token) =>
      token.kind === 'option' &&
      (token.name === 'help' || token.name === 'version'),
  )
  if (metaOption?.kind === 'option') {
    return {
      command: metaOption.name,
      args: [],
      debug,
    }
  }
  return {
    command: argv[boundary.commandIndex],
    args: argv.slice(boundary.commandIndex + 1),
    debug,
  }
}

function globalCommandBoundary(argv: readonly string[]): {
  readonly optionsEnd: number
  readonly commandIndex: number
} {
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]
    if (argument === '--') {
      return { optionsEnd: index, commandIndex: index + 1 }
    }
    if (!argument.startsWith('-')) {
      return { optionsEnd: index, commandIndex: index }
    }
    if (globalOptionConsumesNextArgument(argument)) index++
  }
  return { optionsEnd: argv.length, commandIndex: argv.length }
}

function globalOptionConsumesNextArgument(argument: string): boolean {
  return Object.entries(GLOBAL_OPTIONS).some(
    ([name, option]) =>
      option.type === 'string' &&
      (argument === `--${name}` ||
        ('short' in option && argument === `-${option.short}`)),
  )
}

async function runInitdb(
  argv: readonly string[],
  runtime: CliRuntime,
): Promise<number> {
  if (hasHelp(argv)) {
    await write(runtime.stdout, initdbHelp())
    return 0
  }
  if (hasVersion(argv)) {
    await write(
      runtime.stdout,
      `initdb (PostgreSQL) ${pgliteRuntimeIdentity.artifacts.classic.postgresVersion}\n`,
    )
    return 0
  }
  const dataDir = findDataDirectory(argv) ?? runtime.env.PGDATA
  if (!dataDir) {
    throw new CliUsageError('initdb requires -D, --pgdata, or PGDATA')
  }
  const resolved = resolveDataDirectory(dataDir, runtime.cwd)
  await write(runtime.stderr, `pglite: initializing ${resolved}\n`)
  const options = await configuredInitdb(
    {
      dataDir: resolved,
      args: argv,
      env: runtime.env,
      stdin: runtime.stdin,
      stdout: runtime.stdout,
      stderr: runtime.stderr,
    },
    runtime,
  )
  return withToolSignals(runtime, (signal) =>
    runtime.initdb({ ...options, signal }).then((result) => result.exitCode),
  )
}

async function runPostgresTool(
  command: NativeToolCommand,
  argv: readonly string[],
  runtime: CliRuntime,
): Promise<number> {
  return withToolSignals(runtime, (signal) =>
    runtime.runTool(command, {
      argv,
      env: runtime.env,
      cwd: runtime.cwd,
      stdin: runtime.stdin,
      stdout: runtime.stdout,
      stderr: runtime.stderr,
      signal,
    }),
  )
}

function isPostgresToolCommand(value: string): value is NativeToolCommand {
  return (POSTGRES_TOOL_COMMANDS as readonly string[]).includes(value)
}

async function runServer(
  argv: readonly string[],
  globalDebug: boolean,
  runtime: CliRuntime,
): Promise<number> {
  const parsed = parseServerOptions(argv, globalDebug, runtime)
  if (!parsed) {
    await write(runtime.stdout, serverHelp())
    return 0
  }
  const server = await runtime.createServer({
    postmaster: await configuredPostmaster(parsed.postmaster, runtime),
    listen: parsed.listen,
    debug: parsed.postmaster.debug,
  })
  return runForeground(server, runtime)
}

async function runPostgres(
  argv: readonly string[],
  globalDebug: boolean,
  runtime: CliRuntime,
): Promise<number> {
  if (hasHelp(argv)) {
    await write(runtime.stdout, postgresHelp())
    return 0
  }
  if (hasVersion(argv)) {
    await write(
      runtime.stdout,
      `postgres (PostgreSQL) ${pgliteRuntimeIdentity.artifacts.postmaster.postgresVersion} (PGlite ${packageJson.version})\n`,
    )
    return 0
  }
  const parsed = parsePostgresOptions(argv, globalDebug, runtime)
  const server = await runtime.createServer({
    postmaster: await configuredPostmaster(parsed.postmaster, runtime),
    mode: 'postgres',
    debug: parsed.postmaster.debug,
  })
  return runForeground(server, runtime)
}

interface ParsedServerOptions {
  readonly postmaster: PGlitePostmasterOptions
  readonly listen:
    | { readonly host: string; readonly port: number }
    | { readonly path: string }
}

function parseServerOptions(
  argv: readonly string[],
  globalDebug: boolean,
  runtime: CliRuntime,
): ParsedServerOptions | undefined {
  const parsed = parseOwnedArguments(() =>
    parseArgs({
      args: [...argv],
      options: SERVER_OPTIONS,
      strict: true,
      allowPositionals: false,
      tokens: true,
    }),
  )
  if (parsed.values.help) return undefined

  const dataDir = parsed.values.pgdata ?? runtime.env.PGDATA
  if (!dataDir) {
    throw new CliUsageError('server requires -D, --pgdata, or PGDATA')
  }
  const postmaster = runtimeOptions(globalDebug, runtime.env, 20)
  for (const token of parsed.tokens) {
    if (token.kind !== 'option' || typeof token.value !== 'string') continue
    if (
      token.name === 'max-connections' ||
      token.name === 'pglite-max-sessions'
    ) {
      postmaster.maxConnections = integerOption(
        token.value,
        token.name,
        1,
        10_000,
      )
    } else if (token.name === 'pglite-private-memory-limit') {
      postmaster.privateMaximumMemory = memoryBytes(token.value)
    } else if (token.name === 'pglite-global-memory-limit') {
      postmaster.globalMaximumMemory = memoryBytes(token.value)
    } else if (token.name === 'pglite-scoped-memory-limit') {
      postmaster.scopedMaximumMemory = memoryBytes(token.value)
    } else if (token.name === 'pglite-scoped-memory-mode') {
      postmaster.scopedMemoryMode = scopedMemoryMode(token.value)
    } else if (token.name === 'pglite-log-level') {
      postmaster.debug = debugEnabled(token.value)
    }
  }
  const port = integerOption(parsed.values.port ?? '5432', 'port', 0, 65_535)
  const unixPath = parsed.values.unix
    ? resolveDataDirectory(parsed.values.unix, runtime.cwd)
    : undefined
  const postmasterOptions: PGlitePostmasterOptions = {
    dataDir: resolveDataDirectory(dataDir, runtime.cwd),
    initialize: false,
    maxConnections: postmaster.maxConnections,
    sharedBuffers: parsed.values['shared-buffers'],
    privateMaximumMemory: postmaster.privateMaximumMemory,
    globalMaximumMemory: postmaster.globalMaximumMemory,
    scopedMaximumMemory: postmaster.scopedMaximumMemory,
    scopedMemoryMode: postmaster.scopedMemoryMode,
    debug: postmaster.debug,
    postmasterPid: process.pid,
  }
  return {
    postmaster: postmasterOptions,
    listen: unixPath
      ? { path: unixPath }
      : { host: parsed.values.host ?? '127.0.0.1', port },
  }
}

function parsePostgresOptions(
  argv: readonly string[],
  globalDebug: boolean,
  runtime: CliRuntime,
): { readonly postmaster: PGlitePostmasterOptions } {
  let dataDir: string | undefined
  const forwarded: string[] = []
  const postmaster = runtimeOptions(globalDebug, runtime.env, 100)

  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]
    if (argument === '--') {
      forwarded.push(...argv.slice(index))
      break
    }
    const data = pgdataOption(argv, index, argument)
    if (data) {
      dataDir = data.value
      index = data.nextIndex
      continue
    }
    const consumed = consumeRuntimeOption(argv, index, argument, postmaster)
    if (consumed !== undefined) {
      index = consumed
      continue
    }
    if (argument.startsWith('--pglite-')) {
      throw new CliUsageError(`unknown PGlite postgres option ${argument}`)
    }
    forwarded.push(argument)
  }
  dataDir ??= runtime.env.PGDATA
  if (!dataDir) {
    throw new CliUsageError('postgres requires -D, --pgdata, or PGDATA')
  }
  return {
    postmaster: {
      dataDir: resolveDataDirectory(dataDir, runtime.cwd),
      initialize: false,
      respectPostgresqlConfig: true,
      startParams: forwarded,
      maxConnections: postmaster.maxConnections,
      privateMaximumMemory: postmaster.privateMaximumMemory,
      globalMaximumMemory: postmaster.globalMaximumMemory,
      scopedMaximumMemory: postmaster.scopedMaximumMemory,
      scopedMemoryMode: postmaster.scopedMemoryMode,
      debug: postmaster.debug,
      postmasterPid: process.pid,
    },
  }
}

function runtimeOptions(
  debug: boolean,
  env: Readonly<Record<string, string | undefined>>,
  fallbackConnections: number,
): PostmasterRuntimeOptions {
  return {
    maxConnections: env.PGLITE_MAX_SESSIONS
      ? integerOption(env.PGLITE_MAX_SESSIONS, 'PGLITE_MAX_SESSIONS', 1, 10_000)
      : fallbackConnections,
    privateMaximumMemory: env.PGLITE_PRIVATE_MEMORY_LIMIT
      ? memoryBytes(env.PGLITE_PRIVATE_MEMORY_LIMIT)
      : undefined,
    globalMaximumMemory: env.PGLITE_GLOBAL_MEMORY_LIMIT
      ? memoryBytes(env.PGLITE_GLOBAL_MEMORY_LIMIT)
      : undefined,
    scopedMaximumMemory: env.PGLITE_SCOPED_MEMORY_LIMIT
      ? memoryBytes(env.PGLITE_SCOPED_MEMORY_LIMIT)
      : undefined,
    scopedMemoryMode: env.PGLITE_SCOPED_MEMORY_MODE
      ? scopedMemoryMode(env.PGLITE_SCOPED_MEMORY_MODE)
      : undefined,
    debug,
  }
}

function consumeRuntimeOption(
  argv: readonly string[],
  index: number,
  argument: string,
  options: PostmasterRuntimeOptions,
): number | undefined {
  const sessions = optionValue(argv, index, argument, '--pglite-max-sessions')
  if (sessions) {
    options.maxConnections = integerOption(
      sessions.value,
      'pglite-max-sessions',
      1,
      10_000,
    )
    return sessions.nextIndex
  }
  const privateMemory = optionValue(
    argv,
    index,
    argument,
    '--pglite-private-memory-limit',
  )
  if (privateMemory) {
    options.privateMaximumMemory = memoryBytes(privateMemory.value)
    return privateMemory.nextIndex
  }
  const globalMemory = optionValue(
    argv,
    index,
    argument,
    '--pglite-global-memory-limit',
  )
  if (globalMemory) {
    options.globalMaximumMemory = memoryBytes(globalMemory.value)
    return globalMemory.nextIndex
  }
  const scopedMemory = optionValue(
    argv,
    index,
    argument,
    '--pglite-scoped-memory-limit',
  )
  if (scopedMemory) {
    options.scopedMaximumMemory = memoryBytes(scopedMemory.value)
    return scopedMemory.nextIndex
  }
  const scopedMode = optionValue(
    argv,
    index,
    argument,
    '--pglite-scoped-memory-mode',
  )
  if (scopedMode) {
    options.scopedMemoryMode = scopedMemoryMode(scopedMode.value)
    return scopedMode.nextIndex
  }
  const logLevel = optionValue(argv, index, argument, '--pglite-log-level')
  if (logLevel) {
    options.debug = debugEnabled(logLevel.value)
    return logLevel.nextIndex
  }
  return undefined
}

async function runForeground(
  server: PGliteServer,
  runtime: CliRuntime,
): Promise<number> {
  for (const address of server.addresses) {
    await write(
      runtime.stderr,
      `pglite: listening on ${formatAddress(address)}\n`,
    )
    if (address.transport === 'tcp' && !isLoopback(address.host)) {
      await write(
        runtime.stderr,
        `pglite: warning: PostgreSQL is listening on non-loopback address ${address.host}\n`,
      )
    }
  }

  let requestedMode: PGlitePostmasterShutdownMode | undefined
  let shutdownFailure: unknown
  let shutdown: Promise<void> | undefined
  const requestShutdown = (mode: PGlitePostmasterShutdownMode) => {
    if (shutdown) return
    requestedMode = mode
    shutdown = server.close({ mode }).catch((error) => {
      shutdownFailure = error
    })
  }
  const handlers: Partial<Record<NodeJS.Signals, () => void>> = {
    SIGTERM: () => requestShutdown('smart'),
    SIGINT: () => requestShutdown('fast'),
    SIGQUIT: () => requestShutdown('immediate'),
    SIGHUP: () => {
      try {
        server.reload()
      } catch (error) {
        shutdownFailure = error
        requestShutdown('immediate')
      }
    },
  }
  for (const [signal, handler] of Object.entries(handlers)) {
    runtime.signals.on(signal as NodeJS.Signals, handler)
  }
  let exit: PGlitePostmasterExit
  try {
    exit = await server.postmaster.waitForExit()
    await (shutdown ?? server.close({ mode: 'immediate' }))
  } finally {
    for (const [signal, handler] of Object.entries(handlers)) {
      runtime.signals.off(signal as NodeJS.Signals, handler)
    }
  }
  if (shutdownFailure) throw shutdownFailure
  if (requestedMode && exit.exitCode === 0) return 0
  return exit.exitCode === 0 ? 1 : exit.exitCode
}

async function withToolSignals(
  runtime: CliRuntime,
  operation: (signal: AbortSignal) => Promise<number>,
): Promise<number> {
  const controller = new AbortController()
  const abort = () => controller.abort()
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGQUIT'] as const) {
    runtime.signals.on(signal, abort)
  }
  try {
    return await operation(controller.signal)
  } finally {
    for (const signal of ['SIGTERM', 'SIGINT', 'SIGQUIT'] as const) {
      runtime.signals.off(signal, abort)
    }
  }
}

function findDataDirectory(argv: readonly string[]): string | undefined {
  let dataDir: string | undefined
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === '--') break
    const option = pgdataOption(argv, index, argv[index])
    if (option) {
      dataDir = option.value
      index = option.nextIndex
    }
  }
  return dataDir
}

function pgdataOption(
  argv: readonly string[],
  index: number,
  argument: string,
): { readonly value: string; readonly nextIndex: number } | undefined {
  return optionValue(argv, index, argument, '--pgdata', '-D')
}

function optionValue(
  argv: readonly string[],
  index: number,
  argument: string,
  long: string,
  short?: string,
): { readonly value: string; readonly nextIndex: number } | undefined {
  if (argument === long || argument === short) {
    const value = argv[index + 1]
    if (value === undefined)
      throw new CliUsageError(`${argument} needs a value`)
    return { value, nextIndex: index + 1 }
  }
  if (argument.startsWith(`${long}=`)) {
    const value = argument.slice(long.length + 1)
    if (!value) throw new CliUsageError(`${long} needs a value`)
    return { value, nextIndex: index }
  }
  if (short && argument.startsWith(short) && argument.length > short.length) {
    return { value: argument.slice(short.length), nextIndex: index }
  }
  return undefined
}

function resolveDataDirectory(value: string, cwd: string): string {
  if (value.startsWith('file:')) return resolve(fileURLToPath(value))
  if (value.includes('://')) {
    throw new CliUsageError('the CLI currently requires a Node filesystem path')
  }
  return resolve(cwd, value)
}

function integerOption(
  value: string,
  label: string,
  minimum: number,
  maximum: number,
): number {
  if (!/^\d+$/.test(value)) {
    throw new CliUsageError(`${label} must be an integer`)
  }
  const result = Number(value)
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) {
    throw new CliUsageError(
      `${label} must be between ${minimum} and ${maximum}`,
    )
  }
  return result
}

function memoryBytes(value: string): number {
  const match = /^(\d+)(B|KB|MB|GB|KiB|MiB|GiB)?$/i.exec(value)
  if (!match) throw new CliUsageError(`invalid memory size ${value}`)
  const units: Record<string, number> = {
    B: 1,
    KB: 1_000,
    MB: 1_000_000,
    GB: 1_000_000_000,
    KIB: 1_024,
    MIB: 1_048_576,
    GIB: 1_073_741_824,
  }
  const bytes = Number(match[1]) * units[(match[2] ?? 'B').toUpperCase()]
  if (!Number.isSafeInteger(bytes) || bytes <= 0) {
    throw new CliUsageError(`invalid memory size ${value}`)
  }
  return bytes
}

function scopedMemoryMode(value: string): 'compact' | 'dedicated' {
  if (value === 'compact' || value === 'dedicated') return value
  throw new CliUsageError(
    `pglite scoped memory mode must be compact or dedicated`,
  )
}

function debugEnabled(value: string | undefined): boolean {
  if (!value) return false
  return ['1', 'true', 'debug', 'trace'].includes(value.toLowerCase())
}

async function configuredPostmaster(
  options: PGlitePostmasterOptions,
  runtime: CliRuntime,
): Promise<PGlitePostmasterOptions> {
  const specifier = runtime.env.PGLITE_CONFIG
  if (!specifier) return options
  const loaded = await runtime.loadConfiguration(specifier, runtime.cwd)
  if (!loaded || typeof loaded !== 'object' || Array.isArray(loaded)) {
    throw new TypeError(
      'PGLITE_CONFIG must default-export a configuration object',
    )
  }
  const configuration = loaded as PGliteNodeConfiguration
  const postmaster = configuration.postmaster
  if (postmaster === undefined) return options
  if (
    !postmaster ||
    typeof postmaster !== 'object' ||
    Array.isArray(postmaster)
  ) {
    throw new TypeError('PGLITE_CONFIG postmaster must be an object')
  }
  const allowed = new Set([
    'artifact',
    'fs',
    'workerFilesystem',
    'icuDataDir',
    'osUser',
    'extensions',
    'locateExtensionArtifact',
    'extensionArtifactLimits',
  ])
  for (const name of Object.keys(postmaster)) {
    if (!allowed.has(name)) {
      throw new TypeError(`PGLITE_CONFIG cannot override postmaster.${name}`)
    }
  }
  return { ...options, ...postmaster }
}

async function configuredInitdb(
  options: InitdbOptions,
  runtime: CliRuntime,
): Promise<InitdbOptions> {
  const specifier = runtime.env.PGLITE_CONFIG
  if (!specifier) return options
  const loaded = await runtime.loadConfiguration(specifier, runtime.cwd)
  if (!loaded || typeof loaded !== 'object' || Array.isArray(loaded)) {
    throw new TypeError(
      'PGLITE_CONFIG must default-export a configuration object',
    )
  }
  const configuration = loaded as PGliteNodeConfiguration
  const configured = configuration.initdb
  if (configured === undefined) return options
  if (
    !configured ||
    typeof configured !== 'object' ||
    Array.isArray(configured)
  ) {
    throw new TypeError('PGLITE_CONFIG initdb must be an object')
  }
  for (const name of Object.keys(configured)) {
    if (name !== 'icuDataDir') {
      throw new TypeError(`PGLITE_CONFIG cannot override initdb.${name}`)
    }
  }
  return { ...options, ...configured }
}

async function loadConfigurationModule(
  specifier: string,
  cwd: string,
): Promise<unknown> {
  const url = specifier.startsWith('file:')
    ? new URL(specifier)
    : pathToFileURL(resolve(cwd, specifier))
  const module = (await import(url.href)) as { default?: unknown }
  return module.default
}

function hasHelp(argv: readonly string[]): boolean {
  return hasOptionBeforeSeparator(argv, '--help', '-?')
}

function hasVersion(argv: readonly string[]): boolean {
  return hasOptionBeforeSeparator(argv, '--version', '-V')
}

function hasOptionBeforeSeparator(
  argv: readonly string[],
  ...options: readonly string[]
): boolean {
  for (const argument of argv) {
    if (argument === '--') return false
    if (options.includes(argument)) return true
  }
  return false
}

function formatAddress(address: PGliteServerAddress): string {
  return address.transport === 'unix'
    ? address.path
    : `${address.host}:${address.port}`
}

function isLoopback(host: string): boolean {
  return (
    host === 'localhost' ||
    host === '::1' ||
    host === '[::1]' ||
    /^127(?:\.\d{1,3}){3}$/.test(host)
  )
}

function write(stream: NodeJS.WritableStream, text: string): Promise<void> {
  return new Promise((resolveWrite, rejectWrite) => {
    stream.write(text, (error?: Error | null) =>
      error ? rejectWrite(error) : resolveWrite(),
    )
  })
}

function versionText(): string {
  return `pglite ${packageJson.version} (PostgreSQL ${pgliteRuntimeIdentity.artifacts.postmaster.postgresVersion})\n`
}

function commandHelp(command: string | undefined): string {
  if (!command) return mainHelp()
  if (!COMMANDS.includes(command as Command)) {
    throw new CliUsageError(`unknown command ${JSON.stringify(command)}`)
  }
  if (command === 'initdb') return initdbHelp()
  if (command === 'server') return serverHelp()
  if (command === 'postgres') return postgresHelp()
  if (isPostgresToolCommand(command)) {
    return `Usage: pglite ${command} [PostgreSQL ${command} options]\n\nRun "pglite ${command} --help" for the PostgreSQL option reference.\n`
  }
  return command === 'version' ? versionText() : mainHelp()
}

function mainHelp(): string {
  return `PGlite Node distribution

Usage: pglite [global-options] <command> [arguments]

Commands:
  initdb       initialize a PostgreSQL data directory
  server       run the PGlite-oriented Node socket server
  postgres     run with PostgreSQL-controlled listeners and arguments
  pg_isready   report PostgreSQL connection readiness
  psql         run SQL and psql meta-commands
  pg_dump      export a PostgreSQL database
  pg_restore   restore a pg_dump archive
  createdb     create a database
  createuser   create a role
  dropdb       remove a database
  dropuser     remove a role
  clusterdb    cluster tables
  vacuumdb     vacuum and analyze databases
  reindexdb    reindex databases
  help         show help for a command
  version      show PGlite and PostgreSQL versions

Global options:
  --help, -?                    show this help
  --version, -V                 show versions
  --pglite-log-level=LEVEL      off, info, debug, or trace
`
}

function initdbHelp(): string {
  return `Usage: pglite initdb -D DATADIR [PostgreSQL initdb options]

Arguments after initdb are preserved for PostgreSQL. Native defaults are used;
PGlite does not inject authentication, locale, or encoding options.
`
}

function serverHelp(): string {
  return `Usage: pglite server -D DATADIR [options]

Options:
  -D, --pgdata=PATH                    existing PostgreSQL data directory
  -h, --host=HOST                      listener host (default 127.0.0.1)
  -p, --port=PORT                      listener port (default 5432)
  -k, --unix=PATH                      listen on one Unix-domain socket
  --max-connections=N                  maximum sessions (default 20)
  --shared-buffers=SIZE                managed PostgreSQL shared_buffers
  --pglite-private-memory-limit=SIZE   per-backend Wasm maximum
  --pglite-global-memory-limit=SIZE    global shared Wasm maximum
  --pglite-scoped-memory-limit=SIZE    scoped shared Wasm maximum
  --pglite-scoped-memory-mode=MODE     compact or dedicated

The first release never initializes implicitly; run pglite initdb first.
`
}

function postgresHelp(): string {
  return `Usage: pglite postgres -D DATADIR [PostgreSQL options] [PGlite options]

PostgreSQL resolves listen_addresses, port, Unix socket directories, included
configuration, and -c settings. PGlite removes only the host -D mapping and its
own --pglite-* controls before forwarding the remaining argument vector.

PGlite options:
  --pglite-max-sessions=N
  --pglite-private-memory-limit=SIZE
  --pglite-global-memory-limit=SIZE
  --pglite-scoped-memory-limit=SIZE
  --pglite-scoped-memory-mode=MODE
  --pglite-log-level=LEVEL

The first release runs in the foreground and never initializes implicitly.
`
}
