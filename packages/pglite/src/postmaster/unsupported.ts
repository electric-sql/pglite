import type { PGlitePostmaster as NodePGlitePostmaster } from './node/postmaster.js'
import type { PGlitePostmasterSession as SharedPGlitePostmasterSession } from './shared/session.js'

export type * from './types.js'
export type {
  PGlitePostmasterDiagnostics,
  PGlitePostmasterFilesystemDiagnostics,
  PGlitePostmasterOptions,
  PGliteScopedLifetimeDiagnostics,
} from './node/postmaster.js'
export type { PGlitePostmasterSessionOptions } from './shared/session.js'
export type { BrokeredFilesystemDiagnostics } from './node/filesystem-broker.js'
export type {
  PostmasterArtifactPaths,
  WorkerFilesystemFactory,
} from './node/worker-types.js'
export { PostgresProcessKind, ProcessExitKind } from './shared/control.js'

export class PGlitePostmasterUnavailableError extends Error {
  constructor() {
    super(
      'PGlitePostmaster is not available in this runtime; the current release supports the multi-session postmaster on Node.js only',
    )
    this.name = 'PGlitePostmasterUnavailableError'
  }
}

class UnsupportedPostmaster {
  static create(): never {
    throw new PGlitePostmasterUnavailableError()
  }
}

class UnsupportedSession {
  static create(): never {
    throw new PGlitePostmasterUnavailableError()
  }
}

/** Runtime stub selected outside Node until the browser postmaster is shipped. */
export const PGlitePostmaster =
  UnsupportedPostmaster as unknown as typeof NodePGlitePostmaster
export type PGlitePostmaster = NodePGlitePostmaster

/** Runtime stub preserving the postmaster subpath's value export shape. */
export const PGlitePostmasterSession =
  UnsupportedSession as unknown as typeof SharedPGlitePostmasterSession
export type PGlitePostmasterSession = SharedPGlitePostmasterSession
