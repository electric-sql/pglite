import type { PGlitePostmasterOptions } from '@electric-sql/pglite/postmaster'

export type PGliteNodePostmasterConfiguration = Partial<
  Pick<
    PGlitePostmasterOptions,
    | 'artifact'
    | 'fs'
    | 'workerFilesystem'
    | 'icuDataDir'
    | 'osUser'
    | 'extensions'
    | 'locateExtensionArtifact'
    | 'extensionArtifactLimits'
  >
>

export interface PGliteNodeConfiguration {
  readonly initdb?: {
    readonly icuDataDir?: Blob | File
  }
  readonly postmaster?: PGliteNodePostmasterConfiguration
}
