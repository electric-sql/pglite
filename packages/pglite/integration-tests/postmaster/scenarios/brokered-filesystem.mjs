#!/usr/bin/env node

import assert from 'node:assert/strict'
import {
  chmodSync,
  closeSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  renameSync,
  rmdirSync,
  truncateSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

const [repoRoot, wasm, glue, data] = process.argv.slice(2)
if (!data) {
  throw new Error('usage: brokered-filesystem.mjs REPO_ROOT WASM GLUE DATA')
}

const placeholder = await mkdtemp(join(tmpdir(), 'pglite-broker-placeholder-'))
const backing = await mkdtemp(join(tmpdir(), 'pglite-broker-backing-'))
let postmaster
let sessions = []
let errnoCodes

try {
  const [
    { PGlitePostmaster },
    { BaseFilesystem, ERRNO_CODES },
    { NodeClusterLeaseProvider },
  ] = await Promise.all([
    import(
      pathToFileURL(join(repoRoot, 'packages/pglite/dist/postmaster/index.js'))
        .href
    ),
    import(
      pathToFileURL(join(repoRoot, 'packages/pglite/dist/fs/base.js')).href
    ),
    import(
      pathToFileURL(join(repoRoot, 'packages/pglite/dist/fs/nodefs.js')).href
    ),
  ])
  errnoCodes = ERRNO_CODES

  class NonCloneableNodeFilesystem extends BaseFilesystem {
    openDescriptors = new Set()
    closeCalls = 0
    syncCalls = 0
    nonCloneable = () => 'the broker must retain this object in the supervisor'

    constructor(root) {
      super('memory://postmaster-broker-test', {
        debug: process.env.PGLITE_BROKER_FS_DEBUG === 'true',
      })
      this.root = root
      this.capabilities = {
        multiSession: 'supervisor-broker',
        persistence: 'persistent',
        clusterLease: 'exclusive',
      }
      const leaseProvider = new NodeClusterLeaseProvider()
      this.clusterLeaseProvider = {
        acquireExclusiveClusterLease: (_dataDir, metadata) =>
          leaseProvider.acquireExclusiveClusterLease(root, metadata),
      }
    }

    chmod(path, mode) {
      return checked(() => chmodSync(this.local(path), mode))
    }

    close(fd) {
      return checked(() => {
        if (!this.openDescriptors.delete(fd)) {
          throw errnoError(ERRNO_CODES.EBADF, 'bad file descriptor')
        }
        closeSync(fd)
      })
    }

    fstat(fd) {
      return checked(() => stats(fstatSync(fd)))
    }

    lstat(path) {
      return checked(() => stats(lstatSync(this.local(path))))
    }

    mkdir(path, options) {
      return checked(() => mkdirSync(this.local(path), options))
    }

    open(path, flags = 'r+', mode) {
      return checked(() => {
        const fd = openSync(this.local(path), flags, mode)
        this.openDescriptors.add(fd)
        return fd
      })
    }

    readdir(path) {
      return checked(() => readdirSync(this.local(path)))
    }

    read(fd, buffer, offset, length, position) {
      return checked(() =>
        readSync(fd, byteView(buffer), offset, length, position),
      )
    }

    rename(oldPath, newPath) {
      return checked(() => renameSync(this.local(oldPath), this.local(newPath)))
    }

    rmdir(path) {
      return checked(() => rmdirSync(this.local(path)))
    }

    truncate(path, length) {
      return checked(() => truncateSync(this.local(path), length))
    }

    unlink(path) {
      return checked(() => unlinkSync(this.local(path)))
    }

    utimes(path, atime, mtime) {
      return checked(() =>
        utimesSync(this.local(path), new Date(atime), new Date(mtime)),
      )
    }

    writeFile(path, contents, options) {
      return checked(() => writeFileSync(this.local(path), contents, options))
    }

    write(fd, buffer, offset, length, position) {
      return checked(() =>
        writeSync(fd, byteView(buffer), offset, length, position),
      )
    }

    async syncToFs() {
      this.syncCalls++
    }

    async closeFs() {
      this.closeCalls++
      assert.equal(this.openDescriptors.size, 0)
    }

    local(path) {
      const local = resolve(this.root, path.replace(/^\/+/, ''))
      const fromRoot = relative(this.root, local)
      if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`)) {
        throw errnoError(ERRNO_CODES.EINVAL, `path escapes PGDATA: ${path}`)
      }
      return local
    }
  }

  const firstFilesystem = new NonCloneableNodeFilesystem(backing)
  postmaster = await PGlitePostmaster.create({
    dataDir: `file://${placeholder}`,
    maxConnections: 6,
    sharedBuffers: '16MB',
    artifact: { wasm, glue, data },
    fs: firstFilesystem,
  })
  assert.equal(postmaster.diagnostics().filesystem.strategy, 'broker')

  sessions = await Promise.all([
    createSessionWhenReady(postmaster),
    createSessionWhenReady(postmaster),
  ])
  await sessions[0].exec(`
    CREATE TABLE broker_probe (
      id integer PRIMARY KEY,
      owner text NOT NULL,
      payload text NOT NULL
    );
  `)
  await Promise.all([
    sessions[0].exec(`
      INSERT INTO broker_probe
      SELECT value, 'a', repeat(md5(value::text), 64)
      FROM generate_series(1, 128) value;
    `),
    sessions[1].exec(`
      INSERT INTO broker_probe
      SELECT value, 'b', repeat(md5(value::text), 64)
      FROM generate_series(129, 256) value;
    `),
  ])
  const aggregate = await sessions[0].query(`
    SELECT count(*)::int AS rows,
           count(DISTINCT owner)::int AS owners,
           sum(length(payload))::int AS payload_bytes
    FROM broker_probe;
  `)
  assert.deepEqual(aggregate.rows, [
    { rows: 256, owners: 2, payload_bytes: 524288 },
  ])

  const victim = await sessions[1].query('SELECT pg_backend_pid()::int AS pid')
  await terminateBackendWorker(postmaster, victim.rows[0].pid)
  await sessions[1].close().catch(() => undefined)
  sessions.splice(1, 1)

  const replacement = await createSessionWhenReady(postmaster)
  sessions.push(replacement)
  const afterFailure = await replacement.query(
    'SELECT count(*)::int AS rows FROM broker_probe',
  )
  assert.deepEqual(afterFailure.rows, [{ rows: 256 }])
  await Promise.allSettled(sessions.map((session) => session.close()))
  sessions = []
  await postmaster.close()
  const firstDiagnostics = postmaster.diagnostics()
  postmaster = undefined
  assertBrokerCleanup(firstDiagnostics)
  assert.equal(firstFilesystem.closeCalls, 1)
  assert.ok(firstFilesystem.syncCalls >= 1)

  const secondFilesystem = new NonCloneableNodeFilesystem(backing)
  postmaster = await PGlitePostmaster.create({
    dataDir: `file://${placeholder}`,
    initialize: false,
    maxConnections: 4,
    sharedBuffers: '16MB',
    artifact: { wasm, glue, data },
    fs: secondFilesystem,
  })
  const restarted = await createSessionWhenReady(postmaster)
  sessions = [restarted]
  const persisted = await restarted.query(`
    SELECT count(*)::int AS rows,
           min(id)::int AS first,
           max(id)::int AS last,
           sum(length(payload))::int AS payload_bytes
    FROM broker_probe;
  `)
  assert.deepEqual(persisted.rows, [
    { rows: 256, first: 1, last: 256, payload_bytes: 524288 },
  ])
  await restarted.close()
  sessions = []
  await postmaster.close()
  const secondDiagnostics = postmaster.diagnostics()
  postmaster = undefined
  assertBrokerCleanup(secondDiagnostics)
  assert.equal(secondFilesystem.closeCalls, 1)

  console.log('Brokered filesystem test: PASS')
} finally {
  await Promise.allSettled(sessions.map((session) => session.close()))
  await postmaster?.close().catch(() => undefined)
  await rm(placeholder, { recursive: true, force: true })
  await rm(backing, { recursive: true, force: true })
}

function assertBrokerCleanup(diagnostics) {
  assert.equal(diagnostics.livePrivateMemories, 0)
  assert.equal(diagnostics.filesystem.strategy, 'broker')
  assert.ok(diagnostics.filesystem.broker.requests > 0)
  assert.equal(diagnostics.filesystem.broker.liveChannels, 0)
  assert.equal(diagnostics.filesystem.broker.liveHandles, 0)
  assert.equal(
    diagnostics.filesystem.broker.handlesOpened,
    diagnostics.filesystem.broker.handlesClosed,
  )
}

async function terminateBackendWorker(postmaster, pid) {
  const record = postmaster.workers?.get(pid)
  assert.ok(record, `PostgreSQL Worker ${pid} is not live`)
  await record.worker.terminate()
}

function byteView(value) {
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  }
  if (value instanceof ArrayBuffer || value instanceof SharedArrayBuffer) {
    return new Uint8Array(value)
  }
  throw new TypeError('expected a byte buffer')
}

function stats(value) {
  return {
    dev: value.dev,
    ino: value.ino,
    mode: value.mode,
    nlink: value.nlink,
    uid: value.uid,
    gid: value.gid,
    rdev: value.rdev,
    size: value.size,
    blksize: value.blksize,
    blocks: value.blocks,
    atime: value.atimeMs,
    mtime: value.mtimeMs,
    ctime: value.ctimeMs,
  }
}

function checked(operation) {
  try {
    return operation()
  } catch (error) {
    if (process.env.PGLITE_BROKER_FS_DEBUG === 'true') {
      console.error('broker filesystem operation failed', error)
    }
    if (typeof error?.code === 'number') throw error
    const code = errnoCodes[error?.code] ?? errnoCodes.EINVAL
    throw errnoError(code, error?.message ?? String(error))
  }
}

function errnoError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

async function createSessionWhenReady(server) {
  const deadline = Date.now() + 30_000
  let lastError
  while (Date.now() < deadline) {
    try {
      return await server.createSession()
    } catch (error) {
      lastError = error
      await new Promise((resolveRetry) => setTimeout(resolveRetry, 100))
    }
  }
  throw lastError ?? new Error('postmaster session did not become ready')
}
