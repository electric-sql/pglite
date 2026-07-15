import generatedIdentity from '../release/runtime-identity.json'

export interface NativeToolArtifactIdentity {
  readonly artifactSha256: string
  readonly buildId: string
}

export interface NativeToolRuntimeIdentity {
  readonly schemaVersion: 1
  readonly pgliteAbiVersion: 1
  readonly postgresVersion: string
  readonly postgresVersionNum: number
  readonly catalogVersion: number
  readonly emscriptenVersion: string
  readonly artifacts: {
    readonly pg_dump: NativeToolArtifactIdentity
    readonly pg_isready: NativeToolArtifactIdentity
  }
}

export const nativeToolRuntimeIdentity = Object.freeze(
  generatedIdentity as NativeToolRuntimeIdentity,
)
