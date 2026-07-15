import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'
import { PassThrough, Readable, Writable } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'

const integration =
  process.env.PGLITE_INITDB_INTEGRATION === 'true' ? describe : describe.skip
const roots = new Set<string>()

afterEach(async () => {
  await Promise.all(
    [...roots].map((root) => rm(root, { recursive: true, force: true })),
  )
  roots.clear()
})

integration('standalone initdb runtime', () => {
  it('uses native defaults, streams output, writes a manifest, and boots the cluster', async () => {
    const root = await temporaryRoot()
    const dataDir = join(root, 'data')
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    const stdoutChunks: Buffer[] = []
    stdout.on('data', (chunk) => stdoutChunks.push(Buffer.from(chunk)))
    const { initdb } = await import('../dist/initdb.js')
    const result = await initdb({
      dataDir,
      stdin: Readable.from([]),
      stdout,
      stderr,
      env: { LANG: 'C.UTF-8' },
    })

    expect(result.exitCode).toBe(0)
    expect(stdoutChunks.length).toBeGreaterThan(5)
    expect(await readFile(join(dataDir, 'PG_VERSION'), 'utf8')).toBe('18\n')
    const manifest = JSON.parse(
      await readFile(join(dataDir, '.pglite', 'cluster.json'), 'utf8'),
    )
    expect(manifest).toMatchObject({
      manifestVersion: 1,
      postgresMajor: 18,
      dataChecksums: true,
      encoding: 'UTF8',
      localeProvider: 'libc',
    })

    const { PGlite } = await import('../../pglite/dist/index.js')
    const classic = await PGlite.create({ dataDir: `file://${dataDir}` })
    expect((await classic.query('SELECT 21 * 2 AS answer')).rows).toEqual([
      { answer: 42 },
    ])
    await classic.close()

    const { PGlitePostmaster } = await import(
      '../../pglite/dist/postmaster/index.js'
    )
    const postmaster = await PGlitePostmaster.create({
      dataDir: `file://${dataDir}`,
      maxConnections: 4,
      sharedBuffers: '16MB',
    })
    try {
      const session = await createReadySession(postmaster)
      expect((await session.query('SELECT 6 * 7 AS answer')).rows).toEqual([
        { answer: 42 },
      ])
      await session.close()
    } finally {
      await postmaster.shutdown('fast')
    }
  }, 60_000)

  it('does not use the host login as its post-bootstrap database role', async () => {
    const root = await temporaryRoot()
    const dataDir = join(root, 'host-identity')
    const { initdb } = await import('../dist/initdb.js')
    const result = await initdb({
      dataDir,
      stdin: Readable.from([]),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      env: {
        LANG: 'C.UTF-8',
        USER: 'host-user-without-a-postgres-role',
        LOGNAME: 'host-user-without-a-postgres-role',
        PGUSER: undefined,
      },
    })

    expect(result.exitCode).toBe(0)
    expect(await readFile(join(dataDir, 'PG_VERSION'), 'utf8')).toBe('18\n')

    const explicitDataDir = join(root, 'explicit-bootstrap-user')
    const explicit = await initdb({
      dataDir: explicitDataDir,
      args: ['--username=pglite_owner'],
      stdin: Readable.from([]),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      env: {
        LANG: 'C.UTF-8',
        USER: 'another-host-user',
        LOGNAME: 'another-host-user',
        PGUSER: 'wrong-database-role',
      },
    })
    expect(explicit.exitCode).toBe(0)
    expect(await readFile(join(explicitDataDir, 'PG_VERSION'), 'utf8')).toBe(
      '18\n',
    )
  }, 30_000)

  it('returns PostgreSQL failure status without creating a manifest', async () => {
    const root = await temporaryRoot()
    const dataDir = join(root, 'not-empty')
    await mkdir(dataDir)
    await writeFile(join(dataDir, 'existing'), 'keep')
    const { initdb } = await import('../dist/initdb.js')
    const result = await initdb({
      dataDir,
      args: ['--auth=trust'],
      stdin: Readable.from([]),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
    })
    expect(result.exitCode).not.toBe(0)
    expect(existsSync(join(dataDir, '.pglite', 'cluster.json'))).toBe(false)
    expect(await readFile(join(dataDir, 'existing'), 'utf8')).toBe('keep')
  }, 30_000)

  it('terminates an isolated invocation on abort and never reports success', async () => {
    const root = await temporaryRoot()
    const dataDir = join(root, 'cancelled')
    const controller = new AbortController()
    let writes = 0
    const stdout = new Writable({
      write(_chunk, _encoding, callback) {
        writes++
        if (writes === 2) controller.abort()
        setImmediate(callback)
      },
    })
    const { initdb } = await import('../dist/initdb.js')
    const result = await initdb({
      dataDir,
      args: ['--auth=trust'],
      stdin: Readable.from([]),
      stdout,
      stderr: new PassThrough(),
      signal: controller.signal,
    })
    expect(result.exitCode).toBe(130)
    expect(existsSync(join(dataDir, '.pglite', 'cluster.json'))).toBe(false)
  }, 30_000)

  it('rejects an incompatible manifest before starting a postmaster Worker', async () => {
    const root = await temporaryRoot()
    const dataDir = join(root, 'incompatible')
    const { initdb } = await import('../dist/initdb.js')
    expect(
      (
        await initdb({
          dataDir,
          args: ['--auth=trust'],
          stdin: Readable.from([]),
          stdout: new PassThrough(),
          stderr: new PassThrough(),
        })
      ).exitCode,
    ).toBe(0)
    const manifestPath = join(dataDir, '.pglite', 'cluster.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    await writeFile(
      manifestPath,
      JSON.stringify({
        ...manifest,
        catalogVersion: manifest.catalogVersion + 1,
      }),
    )
    const { PGlitePostmaster } = await import(
      '../../pglite/dist/postmaster/index.js'
    )
    await expect(
      PGlitePostmaster.create({ dataDir, initialize: false }),
    ).rejects.toThrow(/catalog version does not match/)
    expect(existsSync(join(dataDir, 'postmaster.pid'))).toBe(false)
  }, 30_000)

  it('runs native pg_isready and pg_dump through libpq and the Node socket host', async () => {
    const root = await temporaryRoot()
    const dataDir = join(root, 'client-tools')
    const { initdb } = await import('../dist/initdb.js')
    expect(
      (
        await initdb({
          dataDir,
          args: ['--auth=trust'],
          stdin: Readable.from([]),
          stdout: new PassThrough(),
          stderr: new PassThrough(),
        })
      ).exitCode,
    ).toBe(0)

    const { PGlitePostmaster } = await import(
      '../../pglite/dist/postmaster/index.js'
    )
    const { PGliteServer } = await import('../../pglite-server/dist/index.js')
    const postmaster = await PGlitePostmaster.create({
      dataDir: `file://${dataDir}`,
      maxConnections: 4,
      sharedBuffers: '16MB',
    })
    const server = await PGliteServer.create({
      postmaster,
      listen: { host: '127.0.0.1', port: 0 },
    })
    try {
      const session = await createReadySession(postmaster)
      await session.query('CREATE TABLE phase4_native_dump (answer integer)')
      await session.query('INSERT INTO phase4_native_dump VALUES (42)')
      await session.close()

      const address = server.address
      expect(address?.transport).toBe('tcp')
      if (!address || address.transport !== 'tcp')
        throw new Error('missing TCP address')
      const serviceFile = join(root, 'pg_service.conf')
      await writeFile(
        serviceFile,
        `[pglite]\nhost=${address.host}\nport=${address.port}\nuser=postgres\ndbname=postgres\n`,
      )
      const common = {
        env: {
          ...process.env,
          PGUSER: 'postgres',
          PGDATABASE: 'postgres',
          PGSERVICE: 'pglite',
          PGSERVICEFILE: serviceFile,
        },
        stdin: Readable.from([]),
      }
      const readyOut = collectOutput()
      const readyErr = collectOutput()
      const { pgIsReady } = await import('../dist/pg_isready.js')
      expect(
        await pgIsReady({
          argv: [],
          ...common,
          stdout: readyOut.stream,
          stderr: readyErr.stream,
        }),
      ).toBe(0)
      expect(readyOut.text()).toContain('accepting connections')

      const dumpOut = collectOutput()
      const dumpErr = collectOutput()
      const { runPgDump } = await import('../dist/pg_dump_native.js')
      expect(
        await runPgDump({
          argv: ['-f', 'native-dump.sql'],
          ...common,
          cwd: root,
          stdout: dumpOut.stream,
          stderr: dumpErr.stream,
        }),
      ).toBe(0)
      const dump = await readFile(join(root, 'native-dump.sql'), 'utf8')
      expect(dump).toContain('phase4_native_dump')
      expect(dump).toContain('42')
    } finally {
      await server.close()
      await postmaster.shutdown('fast')
    }
  }, 90_000)

  it('terminates an isolated native client invocation on abort', async () => {
    const blackhole = createServer(() => undefined)
    await new Promise<void>((resolve, reject) => {
      blackhole.once('error', reject)
      blackhole.listen(0, '127.0.0.1', resolve)
    })
    try {
      const address = blackhole.address()
      if (!address || typeof address === 'string')
        throw new Error('missing blackhole address')
      const controller = new AbortController()
      const { pgIsReady } = await import('../dist/pg_isready.js')
      const result = pgIsReady({
        argv: ['-h', '127.0.0.1', '-p', String(address.port), '-t', '60'],
        env: process.env,
        stdin: Readable.from([]),
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        signal: controller.signal,
      })
      setTimeout(() => controller.abort(), 25)
      expect(await result).toBe(130)
    } finally {
      await new Promise<void>((resolve, reject) =>
        blackhole.close((error) => (error ? reject(error) : resolve())),
      )
    }
  }, 30_000)

  it('preserves native client argv, diagnostics, and exit status', async () => {
    const { pgIsReady } = await import('../dist/pg_isready.js')
    const versionOut = collectOutput()
    expect(
      await pgIsReady({
        argv: ['--version'],
        env: process.env,
        stdin: Readable.from([]),
        stdout: versionOut.stream,
        stderr: new PassThrough(),
      }),
    ).toBe(0)
    expect(versionOut.text()).toMatch(/pg_isready \(PostgreSQL\) 18\.3/)

    const invalidErr = collectOutput()
    expect(
      await pgIsReady({
        argv: ['--definitely-not-a-postgresql-option'],
        env: process.env,
        stdin: Readable.from([]),
        stdout: new PassThrough(),
        stderr: invalidErr.stream,
      }),
    ).toBe(3)
    expect(invalidErr.text()).toContain('unrecognized option')
  })
})

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'pglite-initdb-integration-'))
  roots.add(root)
  return root
}

async function createReadySession(postmaster: {
  createSession(): Promise<{
    query(sql: string): Promise<{ rows: unknown[] }>
    close(): Promise<void>
  }>
}) {
  let lastError: unknown
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      return await postmaster.createSession()
    } catch (error) {
      lastError = error
      if ((error as { code?: string }).code !== '57P03') throw error
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
  }
  throw lastError
}

function collectOutput(): { stream: Writable; text(): string } {
  const chunks: Buffer[] = []
  return {
    stream: new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.from(chunk))
        callback()
      },
    }),
    text: () => Buffer.concat(chunks).toString('utf8'),
  }
}
