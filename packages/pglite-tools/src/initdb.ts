import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  initdbRuntimeIdentity,
  runInitdbRuntime,
} from '@electric-sql/pglite/_internal/initdb-runtime'

export interface InitdbOptions {
  readonly dataDir: string | URL
  readonly args?: readonly string[]
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly icuDataDir?: Blob | File
  readonly stdin?: NodeJS.ReadableStream
  readonly stdout?: NodeJS.WritableStream
  readonly stderr?: NodeJS.WritableStream
  readonly signal?: AbortSignal
}

export interface InitdbResult {
  readonly dataDir: URL
  readonly exitCode: number
}

const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { peerDependencies?: Record<string, string> }

export async function initdb(options: InitdbOptions): Promise<InitdbResult> {
  if (!options || typeof options !== 'object') {
    throw new TypeError('initdb options are required')
  }
  assertCompatibleRuntime()
  const dataDir = normalizeDataDir(options.dataDir)
  const args = [...(options.args ?? [])]
  assertMatchingPgdata(dataDir, args)

  const result = await runInitdbRuntime({
    dataDir,
    argv: args,
    env: { ...process.env, ...options.env },
    icuDataDir: options.icuDataDir,
    stdin: options.stdin ?? process.stdin,
    stdout: options.stdout ?? process.stdout,
    stderr: options.stderr ?? process.stderr,
    signal: options.signal,
  })
  return { dataDir: pathToFileURL(dataDir), exitCode: result.exitCode }
}

function normalizeDataDir(dataDir: string | URL): string {
  if (dataDir instanceof URL) {
    if (dataDir.protocol !== 'file:') {
      throw new TypeError('initdb dataDir URL must use the file: scheme')
    }
    return resolve(fileURLToPath(dataDir))
  }
  if (typeof dataDir !== 'string' || dataDir.length === 0) {
    throw new TypeError('initdb dataDir must be a non-empty path or file URL')
  }
  return resolve(dataDir)
}

function assertMatchingPgdata(dataDir: string, argv: readonly string[]): void {
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]
    let value: string | undefined
    if (argument === '-D' || argument === '--pgdata') {
      value = argv[++index]
      if (value === undefined) return
    } else if (argument.startsWith('--pgdata=')) {
      value = argument.slice('--pgdata='.length)
    } else if (argument.startsWith('-D') && argument.length > 2) {
      value = argument.slice(2)
    }
    if (value !== undefined && resolve(value) !== dataDir) {
      throw new TypeError(
        `initdb dataDir conflicts with PostgreSQL argument: ${value}`,
      )
    }
  }
}

function assertCompatibleRuntime(): void {
  const requirement = packageJson.peerDependencies?.['@electric-sql/pglite']
  const expectedVersion = requirement?.replace(/^workspace:/, '')
  if (
    initdbRuntimeIdentity.contract !== 'initdb-runtime' ||
    initdbRuntimeIdentity.abiVersion !== 1 ||
    (expectedVersion &&
      expectedVersion !== '*' &&
      expectedVersion !== initdbRuntimeIdentity.coreVersion)
  ) {
    throw new Error(
      `Incompatible @electric-sql/pglite initdb runtime: expected ${expectedVersion ?? 'the packaged peer'} ABI 1, received ${initdbRuntimeIdentity.coreVersion} ABI ${initdbRuntimeIdentity.abiVersion}`,
    )
  }
}
