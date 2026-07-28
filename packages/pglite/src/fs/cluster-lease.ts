import type {
  Filesystem,
  PGliteClusterLease,
  PGliteClusterLeaseMetadata,
} from './base.js'

/** Internal hand-off used when a postmaster owns the lease during initdb. */
export const inheritedClusterLease = Symbol('pglite.inheritedClusterLease')

export interface InheritedClusterLeaseOptions {
  [inheritedClusterLease]?: PGliteClusterLease
}

export async function acquireFilesystemClusterLease(
  filesystem: Filesystem,
  dataDir: string | undefined,
  runtime: PGliteClusterLeaseMetadata['runtime'],
  inherited?: PGliteClusterLease,
): Promise<{ lease?: PGliteClusterLease; owned: boolean }> {
  if (inherited) return { lease: inherited, owned: false }

  const provider = filesystem.clusterLeaseProvider
  const capabilities = filesystem.capabilities
  if (!provider) {
    if (
      capabilities?.persistence === 'persistent' ||
      capabilities?.clusterLease === 'exclusive'
    ) {
      throw new Error(
        'The selected persistent filesystem does not provide an authoritative cluster lease',
      )
    }
    return { owned: false }
  }
  if (capabilities?.clusterLease === 'unsupported') {
    throw new Error(
      'The selected filesystem does not support authoritative cluster ownership',
    )
  }

  const ownerToken = createOwnerToken()
  const lease = await provider.acquireExclusiveClusterLease(dataDir ?? '', {
    ownerToken,
    runtime,
    startedAt: new Date().toISOString(),
  })
  if (lease.ownerToken !== ownerToken) {
    await lease.release().catch(() => {})
    throw new Error('Cluster lease provider returned an unexpected owner token')
  }
  return { lease, owned: true }
}

function createOwnerToken(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }
  const bytes = new Uint8Array(16)
  globalThis.crypto?.getRandomValues(bytes)
  if (bytes.some((byte) => byte !== 0)) {
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
      '',
    )
  }
  throw new Error('A cryptographically secure random owner token is required')
}
