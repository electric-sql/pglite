import generatedIdentity from '../release/runtime-identity.json'

export interface PGliteArtifactIdentity {
  readonly postgresVersion: string
  readonly postgresVersionNum: number
  readonly catalogVersion: number
  readonly pgliteAbiVersion: number
  readonly transformerAbiVersion: number
  readonly emscriptenVersion: string
  readonly memoryTopology: 'classic' | 'multi-memory'
  readonly pointerWidth: 32 | 64
  readonly artifactSha256: string
  readonly buildId: string
}

export interface PGliteRuntimeIdentity {
  readonly schemaVersion: 1
  readonly pgliteVersion: string
  readonly blockSize: number
  readonly walBlockSize: number
  readonly artifacts: {
    readonly classic: PGliteArtifactIdentity
    readonly postmaster: PGliteArtifactIdentity
  }
}

export const pgliteRuntimeIdentity = Object.freeze(
  generatedIdentity as PGliteRuntimeIdentity,
)
