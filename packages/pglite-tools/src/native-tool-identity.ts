import generatedIdentity from '../release/runtime-identity.json'

export interface NativeToolArtifactIdentity {
  readonly artifactSha256: string
  readonly buildId: string
}

export const nativeToolCommands = [
  'pg_dump',
  'pg_isready',
  'psql',
  'pg_restore',
  'createdb',
  'createuser',
  'dropdb',
  'dropuser',
  'clusterdb',
  'vacuumdb',
  'reindexdb',
] as const

export type NativeToolCommand = (typeof nativeToolCommands)[number]

export interface NativeToolRuntimeIdentity {
  readonly schemaVersion: 1
  readonly pgliteAbiVersion: 1
  readonly postgresVersion: string
  readonly postgresVersionNum: number
  readonly catalogVersion: number
  readonly emscriptenVersion: string
  readonly artifacts: Readonly<
    Record<NativeToolCommand, NativeToolArtifactIdentity>
  >
}

const runtimeIdentity = generatedIdentity as NativeToolRuntimeIdentity
for (const command of nativeToolCommands) {
  const artifact = runtimeIdentity.artifacts[command]
  if (
    !artifact ||
    !/^[0-9a-f]{64}$/.test(artifact.artifactSha256) ||
    artifact.buildId !== artifact.artifactSha256
  ) {
    throw new Error(`invalid ${command} native tool artifact identity`)
  }
}

export const nativeToolRuntimeIdentity = Object.freeze(runtimeIdentity)
