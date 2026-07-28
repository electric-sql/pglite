import type { ProcessExitKind } from './shared/control.js'

/** Network metadata supplied by a protocol frontend at connection admission. */
export interface ProtocolPeerInfo {
  readonly transport: 'tcp' | 'unix'
  readonly remoteAddress?: string
  readonly remotePort?: number
}

/** A byte-transparent PostgreSQL frontend/backend protocol connection. */
export interface PGliteProtocolConnection {
  readonly readable: AsyncIterable<Uint8Array>
  readonly closed: Promise<void>
  write(data: Uint8Array): Promise<void>
  end(): Promise<void>
  abort(reason?: unknown): void
}

export type PGliteScopedMemoryMode = 'dedicated' | 'compact'

export type PGlitePostmasterShutdownMode = 'smart' | 'fast' | 'immediate'

export interface PGlitePostmasterExit {
  readonly exitKind: ProcessExitKind
  readonly exitCode: number
}
