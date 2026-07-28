import type { PGliteClusterManifestV1 } from './initdb-runtime-contract.js'
import type { PGliteArtifactIdentity } from './runtime-identity.js'
import type { PostgresMod } from './postgresMod.js'

export interface ClusterFiles {
  readonly pgVersion: string
  readonly control: Uint8Array
  readonly manifest?: string
}

export interface ClusterManifestCreationOptions {
  readonly artifact: PGliteArtifactIdentity
  readonly pgliteVersion: string
  readonly blockSize: number
  readonly walBlockSize: number
  readonly argv: readonly string[]
  readonly detectedEncoding?: string
}

export class PGliteClusterCompatibilityError extends Error {
  override readonly name = 'PGliteClusterCompatibilityError'
}

export function validateClusterFiles(
  files: ClusterFiles,
  artifact: PGliteArtifactIdentity,
  blockSize: number,
  walBlockSize: number,
): PGliteClusterManifestV1 {
  const native = readNativeClusterIdentity(files, artifact)
  if (files.manifest === undefined) {
    throw incompatible(
      'PGlite cluster manifest is missing; explicitly adopt the data directory before startup',
    )
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(files.manifest)
  } catch (error) {
    throw incompatible('PGlite cluster manifest is invalid JSON', error)
  }
  if (!isManifest(parsed))
    throw incompatible('PGlite cluster manifest is invalid')
  if (parsed.postgresMajor !== native.postgresMajor)
    throw incompatible(
      'PGlite cluster manifest PostgreSQL major does not match PG_VERSION',
    )
  if (parsed.catalogVersion !== native.catalogVersion)
    throw incompatible(
      'PGlite cluster manifest catalog version does not match pg_control',
    )
  if (parsed.systemIdentifier !== native.systemIdentifier)
    throw incompatible(
      'PGlite cluster manifest system identifier does not match pg_control',
    )
  if (parsed.blockSize !== blockSize || parsed.walBlockSize !== walBlockSize)
    throw incompatible(
      'PGlite cluster block size is incompatible with this runtime',
    )
  return parsed
}

export function createClusterManifestFromFiles(
  files: Omit<ClusterFiles, 'manifest'>,
  options: ClusterManifestCreationOptions,
): PGliteClusterManifestV1 {
  const native = readNativeClusterIdentity(files, options.artifact)
  return {
    manifestVersion: 1,
    postgresMajor: native.postgresMajor,
    catalogVersion: native.catalogVersion,
    systemIdentifier: native.systemIdentifier,
    blockSize: options.blockSize,
    walBlockSize: options.walBlockSize,
    dataChecksums: !options.argv.includes('--no-data-checksums'),
    encoding:
      optionValue(options.argv, ['-E', '--encoding']) ??
      options.detectedEncoding ??
      'UTF8',
    localeProvider: optionValue(options.argv, ['--locale-provider']) ?? 'libc',
    createdByPGliteVersion: options.pgliteVersion,
    createdByBuildId: options.artifact.buildId,
  }
}

export function encodingFromInitdbOutput(output: string): string | undefined {
  return /database encoding has accordingly been set to ["']([^"']+)["']/i.exec(
    output,
  )?.[1]
}

export function readEmscriptenClusterFiles(
  fs: PostgresMod['FS'],
  root: string,
): ClusterFiles {
  const text = (path: string): string =>
    fs.readFile(path, { encoding: 'utf8' }) as unknown as string
  return {
    pgVersion: text(`${root}/PG_VERSION`),
    control: fs.readFile(`${root}/global/pg_control`) as Uint8Array,
    manifest: fs.analyzePath(`${root}/.pglite/cluster.json`).exists
      ? text(`${root}/.pglite/cluster.json`)
      : undefined,
  }
}

export function writeEmscriptenClusterManifest(
  fs: PostgresMod['FS'],
  root: string,
  manifest: PGliteClusterManifestV1,
): void {
  const directory = `${root}/.pglite`
  if (!fs.analyzePath(directory).exists) fs.mkdir(directory, 0o700)
  const target = `${directory}/cluster.json`
  const temporary = `${directory}/.cluster.${Date.now().toString(36)}.${Math.random().toString(36).slice(2)}.tmp`
  try {
    fs.writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, {
      flags: 'w',
    })
    fs.chmod(temporary, 0o600)
    fs.rename(temporary, target)
  } catch (error) {
    if (fs.analyzePath(temporary).exists) fs.unlink(temporary)
    throw error
  }
}

function readNativeClusterIdentity(
  files: Omit<ClusterFiles, 'manifest'>,
  artifact: PGliteArtifactIdentity,
): {
  readonly postgresMajor: number
  readonly catalogVersion: number
  readonly systemIdentifier: string
} {
  const pgVersion = files.pgVersion.trim()
  const postgresMajor = Number(pgVersion)
  const expectedMajor = Math.floor(artifact.postgresVersionNum / 10_000)
  if (!Number.isInteger(postgresMajor) || postgresMajor !== expectedMajor) {
    throw incompatible(
      `PostgreSQL data directory major ${pgVersion || '<empty>'} is incompatible with runtime major ${expectedMajor}`,
    )
  }
  if (files.control.byteLength < 16)
    throw incompatible('PostgreSQL pg_control is missing or truncated')
  const view = new DataView(
    files.control.buffer,
    files.control.byteOffset,
    files.control.byteLength,
  )
  const catalogVersion = view.getUint32(12, true)
  if (catalogVersion !== artifact.catalogVersion) {
    throw incompatible(
      `PostgreSQL catalog version ${catalogVersion} is incompatible with runtime catalog ${artifact.catalogVersion}`,
    )
  }
  return {
    postgresMajor,
    catalogVersion,
    systemIdentifier: view.getBigUint64(0, true).toString(),
  }
}

function isManifest(value: unknown): value is PGliteClusterManifestV1 {
  if (!value || typeof value !== 'object') return false
  const manifest = value as Record<string, unknown>
  return (
    manifest.manifestVersion === 1 &&
    Number.isInteger(manifest.postgresMajor) &&
    Number.isInteger(manifest.catalogVersion) &&
    typeof manifest.systemIdentifier === 'string' &&
    Number.isInteger(manifest.blockSize) &&
    Number.isInteger(manifest.walBlockSize) &&
    typeof manifest.dataChecksums === 'boolean' &&
    typeof manifest.encoding === 'string' &&
    typeof manifest.localeProvider === 'string' &&
    typeof manifest.createdByPGliteVersion === 'string' &&
    typeof manifest.createdByBuildId === 'string'
  )
}

function optionValue(
  argv: readonly string[],
  names: readonly string[],
): string | undefined {
  for (let index = argv.length - 1; index >= 0; index--) {
    const argument = argv[index]
    for (const name of names) {
      if (argument === name) return argv[index + 1]
      if (argument.startsWith(`${name}=`))
        return argument.slice(name.length + 1)
      if (name.length === 2 && argument.startsWith(name) && argument.length > 2)
        return argument.slice(2)
    }
  }
  return undefined
}

function incompatible(
  message: string,
  cause?: unknown,
): PGliteClusterCompatibilityError {
  const error = new PGliteClusterCompatibilityError(message)
  if (cause !== undefined) (error as Error & { cause?: unknown }).cause = cause
  return error
}
