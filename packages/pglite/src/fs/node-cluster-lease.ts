import { constants } from 'node:fs'
import { open, mkdir, realpath } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import type {
  PGliteClusterLease,
  PGliteClusterLeaseMetadata,
  PGliteClusterLeaseProvider,
} from './base.js'

const LOCK_FILE_SUFFIX = '.pglite.lock'

export class PGliteClusterInUseError extends Error {
  readonly dataDir: string
  readonly owner?: PGliteClusterLeaseMetadata

  constructor(dataDir: string, owner?: PGliteClusterLeaseMetadata) {
    const detail = owner
      ? ` by ${owner.runtime}${owner.pid === undefined ? '' : ` process ${owner.pid}`} since ${owner.startedAt}`
      : ''
    super(`PGlite data directory is already open${detail}: ${dataDir}`)
    this.name = 'PGliteClusterInUseError'
    this.dataDir = dataDir
    this.owner = owner
  }
}

export class NodeClusterLeaseProvider implements PGliteClusterLeaseProvider {
  async acquireExclusiveClusterLease(
    dataDir: string,
    metadata: PGliteClusterLeaseMetadata,
  ): Promise<PGliteClusterLease> {
    if (!dataDir) throw new TypeError('A data directory is required')

    const requestedDataDir = resolve(dataDir)
    await mkdir(requestedDataDir, { recursive: true })
    const canonicalDataDir = await realpath(requestedDataDir)
    // Keep the lock beside PGDATA so acquiring it before initdb does not make
    // an otherwise empty target directory non-empty.
    const lockPath = resolve(
      dirname(canonicalDataDir),
      `.${basename(canonicalDataDir)}${LOCK_FILE_SUFFIX}`,
    )
    const handle = await open(
      lockPath,
      constants.O_CREAT |
        constants.O_RDWR |
        constants.O_APPEND |
        (constants.O_NOFOLLOW ?? 0),
      0o600,
    )
    const storedMetadata = { ...metadata, pid: process.pid }

    try {
      await flockPromise(handle.fd, 'exnb')
    } catch (error) {
      const owner = await readOwnerMetadata(handle)
      await handle.close().catch(() => {})
      if (isLockContended(error)) {
        throw new PGliteClusterInUseError(canonicalDataDir, owner)
      }
      throw error
    }

    try {
      await handle.chmod(0o600)
      await handle.truncate(0)
      await handle.writeFile(`${JSON.stringify(storedMetadata)}\n`, 'utf8')
      await handle.sync()
    } catch (error) {
      await flockPromise(handle.fd, 'un').catch(() => {})
      await handle.close().catch(() => {})
      throw error
    }

    let released = false
    const release = async () => {
      if (released) return
      released = true
      try {
        await flockPromise(handle.fd, 'un')
      } finally {
        await handle.close()
      }
    }
    return {
      ownerToken: metadata.ownerToken,
      release,
      async [Symbol.asyncDispose]() {
        await release()
      },
    }
  }
}

async function readOwnerMetadata(
  handle: Awaited<ReturnType<typeof open>>,
): Promise<PGliteClusterLeaseMetadata | undefined> {
  try {
    const text = await handle.readFile('utf8')
    const value = JSON.parse(text) as Partial<PGliteClusterLeaseMetadata>
    if (
      typeof value.ownerToken === 'string' &&
      (value.runtime === 'classic' || value.runtime === 'postmaster') &&
      typeof value.startedAt === 'string'
    ) {
      return value as PGliteClusterLeaseMetadata
    }
  } catch {
    // Metadata is diagnostic only; the OS-held lock is authoritative.
  }
  return undefined
}

async function flockPromise(
  fd: number,
  operation: 'exnb' | 'un',
): Promise<void> {
  const { flock } = await import('fs-ext-extra-prebuilt')
  await new Promise<void>((resolvePromise, reject) => {
    flock(fd, operation, (error) => {
      if (error) reject(error)
      else resolvePromise()
    })
  })
}

function isLockContended(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  return code === 'EAGAIN' || code === 'EACCES' || code === 'EWOULDBLOCK'
}
