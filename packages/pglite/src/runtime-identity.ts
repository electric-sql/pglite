import generatedIdentity from '../release/runtime-identity.json'
import {
  PGLITE_CLASSIC_MEMORY_ABI,
  PGLITE_EXTENSION_ABI,
  PGLITE_HOST_ABI,
  PGLITE_MULTI_MEMORY_ABI,
  type PGliteWasmTarget,
} from './extension-artifacts.js'

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

export const pgliteClassicWasmTarget = Object.freeze(
  targetFromIdentity(pgliteRuntimeIdentity.artifacts.classic),
)

export const pglitePostmasterWasmTarget = Object.freeze(
  targetFromIdentity(pgliteRuntimeIdentity.artifacts.postmaster),
)

function targetFromIdentity(
  artifact: PGliteArtifactIdentity,
): PGliteWasmTarget {
  return {
    pointerWidth: artifact.pointerWidth,
    memoryAddressWidth: artifact.pointerWidth,
    topology: artifact.memoryTopology,
    postgresMajor: Math.floor(artifact.postgresVersionNum / 10_000),
    postgresAbi: [
      `postgres-${artifact.postgresVersionNum}`,
      `catalog-${artifact.catalogVersion}`,
      `block-${pgliteRuntimeIdentity.blockSize}`,
      `wal-${pgliteRuntimeIdentity.walBlockSize}`,
      `wasm${artifact.pointerWidth}`,
    ].join('-'),
    pgliteExtensionAbi: PGLITE_EXTENSION_ABI,
    memoryAbi:
      artifact.memoryTopology === 'classic'
        ? PGLITE_CLASSIC_MEMORY_ABI
        : PGLITE_MULTI_MEMORY_ABI,
    hostAbi: PGLITE_HOST_ABI,
  }
}
