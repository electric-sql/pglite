#!/usr/bin/env node

import { spawn, type ChildProcess } from 'node:child_process'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { PGlitePostmaster } from '@electric-sql/pglite/postmaster'
import {
  PGliteSocketServer,
  type PGliteSocketAddress,
  type PGliteSocketListenOptions,
} from '../index.js'

const parsed = parseArgs({
  options: {
    db: { type: 'string', short: 'd', default: 'file://./pglite-data' },
    host: { type: 'string', short: 'h', default: '127.0.0.1' },
    port: { type: 'string', short: 'p', default: '5432' },
    socket: { type: 'string', short: 'u' },
    'socket-directory': { type: 'string' },
    'max-connections': { type: 'string', short: 'm', default: '20' },
    'shared-buffers': { type: 'string', default: '16MB' },
    set: { type: 'string', multiple: true, default: [] },
    wasm: { type: 'string' },
    glue: { type: 'string' },
    data: { type: 'string' },
    run: { type: 'string', short: 'r' },
    'include-database-url': { type: 'boolean', default: false },
    debug: { type: 'boolean', short: 'v', default: false },
    help: { type: 'boolean', short: '?', default: false },
  },
})

const help = `PGlite multi-session socket server
Usage: pglite-server [options]

Options:
  -d, --db=PATH                 PGDATA directory (default: file://./pglite-data)
  -h, --host=HOST               TCP host (default: 127.0.0.1)
  -p, --port=PORT               TCP or PostgreSQL Unix-socket port (default: 5432)
  -u, --socket=PATH             Exact Unix-socket path
      --socket-directory=DIR    Create DIR/.s.PGSQL.<port> and lock metadata
  -m, --max-connections=N       PostgreSQL max_connections (default: 20)
      --shared-buffers=SIZE     PostgreSQL shared_buffers (default: 16MB)
      --set=NAME=VALUE          Additional PostgreSQL setting (repeatable)
      --wasm=PATH               Postmaster Wasm artifact
      --glue=PATH               Matching Emscripten JavaScript artifact
      --data=PATH               Matching preloaded-data artifact
  -r, --run=COMMAND             Run a command after readiness
      --include-database-url    Export DATABASE_URL to the command
  -v, --debug                   Enable process/frontend diagnostics
  -?, --help                    Show this help
`

if (parsed.values.help) {
  process.stdout.write(help)
  process.exit(0)
}

let postmaster: PGlitePostmaster | undefined
let server: PGliteSocketServer | undefined
let child: ChildProcess | undefined
let shuttingDown = false

async function main(): Promise<void> {
  const port = integerOption('port', parsed.values.port as string, 0, 65_535)
  const maxConnections = integerOption(
    'max-connections',
    parsed.values['max-connections'] as string,
    1,
    10_000,
  )
  const artifactParts = [
    parsed.values.wasm,
    parsed.values.glue,
    parsed.values.data,
  ]
  if (
    artifactParts.some((value) => value !== undefined) &&
    !artifactParts.every((value) => value !== undefined)
  ) {
    throw new Error('--wasm, --glue, and --data must be supplied together')
  }

  const startParams = (parsed.values.set as string[]).flatMap((setting) => [
    '-c',
    setting,
  ])
  postmaster = await PGlitePostmaster.create({
    dataDir: parsed.values.db as string,
    maxConnections,
    sharedBuffers: parsed.values['shared-buffers'] as string,
    startParams,
    debug: parsed.values.debug as boolean,
    artifact: artifactParts[0]
      ? {
          wasm: resolve(artifactParts[0] as string),
          glue: resolve(artifactParts[1] as string),
          data: resolve(artifactParts[2] as string),
        }
      : undefined,
  })
  server = new PGliteSocketServer({
    postmaster,
    listen: listenOptions(port),
    debug: parsed.values.debug as boolean,
  })
  const address = await server.start()
  const environment = clientEnvironment(address)
  process.stdout.write(
    `${JSON.stringify({ type: 'pglite-ready', address, environment })}\n`,
  )

  const command = parsed.values.run as string | undefined
  if (command) {
    child = spawn(command, {
      shell: true,
      stdio: 'inherit',
      env: {
        ...process.env,
        ...environment,
        ...(parsed.values['include-database-url']
          ? { DATABASE_URL: databaseURL(address) }
          : {}),
      },
    })
    const exitCode = await new Promise<number>((resolveExit, rejectExit) => {
      child!.once('error', rejectExit)
      child!.once('exit', (code, signal) => {
        resolveExit(code ?? (signal ? 128 : 1))
      })
    })
    await shutdown()
    process.exitCode = exitCode
  }
}

function listenOptions(port: number): PGliteSocketListenOptions {
  const socket = parsed.values.socket as string | undefined
  const directory = parsed.values['socket-directory'] as string | undefined
  if (socket && directory) {
    throw new Error('--socket and --socket-directory are mutually exclusive')
  }
  if (socket) return { path: socket }
  if (directory) return { directory, port: port || 5432 }
  return { host: parsed.values.host as string, port }
}

function clientEnvironment(
  address: PGliteSocketAddress,
): Record<string, string> {
  return {
    PGHOST:
      address.transport === 'tcp'
        ? address.host
        : (address.directory ?? address.path),
    PGPORT: String(address.port ?? 5432),
    PGDATABASE: 'postgres',
    PGUSER: 'postgres',
    PGSSLMODE: 'disable',
  }
}

function databaseURL(address: PGliteSocketAddress): string {
  if (address.transport === 'tcp') {
    return `postgresql://postgres@${address.host}:${address.port}/postgres?sslmode=disable`
  }
  const host = encodeURIComponent(address.directory ?? address.path)
  return `postgresql://postgres@/postgres?host=${host}&port=${address.port ?? 5432}&sslmode=disable`
}

function integerOption(
  name: string,
  value: string,
  minimum: number,
  maximum: number,
): number {
  const parsedValue = Number(value)
  if (
    !Number.isInteger(parsedValue) ||
    parsedValue < minimum ||
    parsedValue > maximum
  ) {
    throw new Error(
      `--${name} must be an integer from ${minimum} to ${maximum}`,
    )
  }
  return parsedValue
}

async function shutdown(): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  child?.kill('SIGTERM')
  await server?.stop()
  await postmaster?.close()
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void shutdown().then(() => {
      process.exitCode = signal === 'SIGINT' ? 130 : 143
    })
  })
}

void main().catch(async (error) => {
  console.error(error)
  await shutdown()
  process.exitCode = 1
})
