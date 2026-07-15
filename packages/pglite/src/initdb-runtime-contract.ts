export type { PGliteContractRequirement } from './runtime-contract.js'

export interface PGliteClusterManifestV1 {
  readonly manifestVersion: 1
  readonly postgresMajor: number
  readonly catalogVersion: number
  readonly systemIdentifier: string
  readonly blockSize: number
  readonly walBlockSize: number
  readonly dataChecksums: boolean
  readonly encoding: string
  readonly localeProvider: string
  readonly createdByPGliteVersion: string
  readonly createdByBuildId: string
}

export interface InitdbRuntimeInvocation {
  readonly dataDir: string
  readonly argv: readonly string[]
  readonly env: Readonly<Record<string, string | undefined>>
  readonly icuDataDir?: Blob
  readonly stdin: NodeJS.ReadableStream
  readonly stdout: NodeJS.WritableStream
  readonly stderr: NodeJS.WritableStream
  readonly signal?: AbortSignal
}

export interface InitdbRuntimeResult {
  readonly exitCode: number
  /** Present only after initdb and atomic manifest creation both succeed. */
  readonly manifest?: PGliteClusterManifestV1
}

export class PGliteInitdbHostError extends Error {
  readonly cause?: unknown

  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message)
    this.name = 'PGliteInitdbHostError'
    this.cause = options.cause
  }
}
