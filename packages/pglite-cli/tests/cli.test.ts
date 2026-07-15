import { EventEmitter } from 'node:events'
import { PassThrough, Readable } from 'node:stream'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { PGlitePostmasterExit } from '@electric-sql/pglite/postmaster'
import type {
  PGliteServer,
  PGliteServerOptions,
} from '@electric-sql/pglite-server'
import { runCli, type CliRuntime, type SignalSource } from '../src/cli.js'

describe('pglite CLI dispatcher', () => {
  it('prints help without starting a command', async () => {
    const fixture = cliFixture()
    expect(await runCli([], fixture.runtime)).toBe(0)
    expect(fixture.stdout()).toContain('Usage: pglite')
    expect(fixture.initdb).not.toHaveBeenCalled()
    expect(fixture.createServer).not.toHaveBeenCalled()
  })

  it('reports coordinated PGlite and PostgreSQL versions', async () => {
    const fixture = cliFixture()
    expect(await runCli(['version'], fixture.runtime)).toBe(0)
    expect(fixture.stdout()).toMatch(/^pglite 0\.5\.4 \(PostgreSQL 18\.3\)/)
  })

  it('preserves initdb argv, streams, environment, and native status', async () => {
    const fixture = cliFixture({ initdbExitCode: 7 })
    const argv = [
      'initdb',
      '-D',
      './cluster',
      '--encoding=LATIN1',
      '--auth-host=scram-sha-256',
    ]
    expect(await runCli(argv, fixture.runtime)).toBe(7)
    expect(fixture.initdb).toHaveBeenCalledWith(
      expect.objectContaining({
        dataDir: resolve('/test/cwd/cluster'),
        args: argv.slice(1),
        env: fixture.runtime.env,
        stdin: fixture.runtime.stdin,
        stdout: fixture.runtime.stdout,
        stderr: fixture.runtime.stderr,
        signal: expect.any(AbortSignal),
      }),
    )
    expect(fixture.stderr()).toContain('/test/cwd/cluster')
  })

  it.each([
    'pg_isready',
    'psql',
    'pg_dump',
    'pg_restore',
    'createdb',
    'createuser',
    'dropdb',
    'dropuser',
    'clusterdb',
    'vacuumdb',
    'reindexdb',
  ] as const)(
    'passes %s arguments through without reparsing them',
    async (command) => {
      const fixture = cliFixture({ readyExitCode: 2 })
      const argv = ['-h', 'db.example', '-p', '55432', '--timeout=9']
      expect(await runCli([command, ...argv], fixture.runtime)).toBe(2)
      expect(fixture.runTool).toHaveBeenCalledWith(
        command,
        expect.objectContaining({
          argv,
          env: fixture.runtime.env,
          cwd: '/test/cwd',
        }),
      )
    },
  )

  it('does not interpret native arguments after -- as CLI help or version', async () => {
    const fixture = cliFixture()
    expect(
      await runCli(
        ['initdb', '-D', 'data', '--', '--help', '--version'],
        fixture.runtime,
      ),
    ).toBe(0)
    expect(fixture.initdb).toHaveBeenCalledWith(
      expect.objectContaining({
        args: ['-D', 'data', '--', '--help', '--version'],
      }),
    )
    expect(fixture.stdout()).not.toContain('Usage:')
  })

  it('keeps explicit server options distinct from native postgres argv', async () => {
    const fixture = cliFixture({ serverStartupError: new Error('stop') })
    expect(
      await runCli(
        [
          'server',
          '-Ddata',
          '--host=127.0.0.2',
          '--port',
          '55432',
          '--max-connections=8',
          '--shared-buffers=32MB',
        ],
        fixture.runtime,
      ),
    ).toBe(1)
    expect(fixture.createServer).toHaveBeenLastCalledWith(
      expect.objectContaining({
        listen: { host: '127.0.0.2', port: 55432 },
        postmaster: expect.objectContaining({
          dataDir: resolve('/test/cwd/data'),
          initialize: false,
          maxConnections: 8,
          sharedBuffers: '32MB',
        }),
      }),
    )

    fixture.createServer.mockClear()
    expect(
      await runCli(
        [
          'postgres',
          '-D',
          'data',
          '-p',
          '55433',
          '-c',
          'listen_addresses=127.0.0.3',
          '--pglite-max-sessions=120',
        ],
        fixture.runtime,
      ),
    ).toBe(1)
    expect(fixture.createServer).toHaveBeenLastCalledWith(
      expect.objectContaining({
        mode: 'postgres',
        postmaster: expect.objectContaining({
          dataDir: resolve('/test/cwd/data'),
          respectPostgresqlConfig: true,
          initialize: false,
          maxConnections: 120,
          startParams: ['-p', '55433', '-c', 'listen_addresses=127.0.0.3'],
        }),
      }),
    )
  })

  it('loads only pluggable runtime fields from PGLITE_CONFIG', async () => {
    const fixture = cliFixture({
      serverStartupError: new Error('stop'),
      env: { PGLITE_CONFIG: './pglite.config.mjs' },
      configuration: { postmaster: { osUser: 'regression-user' } },
    })
    expect(await runCli(['postgres', '-D', 'data'], fixture.runtime)).toBe(1)
    expect(fixture.loadConfiguration).toHaveBeenCalledWith(
      './pglite.config.mjs',
      '/test/cwd',
    )
    expect(fixture.createServer).toHaveBeenCalledWith(
      expect.objectContaining({
        postmaster: expect.objectContaining({ osUser: 'regression-user' }),
      }),
    )

    const rejected = cliFixture({
      env: { PGLITE_CONFIG: './bad.mjs' },
      configuration: { postmaster: { dataDir: '/override' } },
    })
    expect(await runCli(['server', '-D', 'data'], rejected.runtime)).toBe(1)
    expect(rejected.stderr()).toContain('cannot override postmaster.dataDir')
    expect(rejected.createServer).not.toHaveBeenCalled()
  })

  it('loads only the ICU archive from PGLITE_CONFIG for initdb', async () => {
    const icuDataDir = new Blob(['icu archive'])
    const fixture = cliFixture({
      env: { PGLITE_CONFIG: './pglite.config.mjs' },
      configuration: { initdb: { icuDataDir } },
    })
    expect(await runCli(['initdb', '-D', 'data'], fixture.runtime)).toBe(0)
    expect(fixture.initdb).toHaveBeenCalledWith(
      expect.objectContaining({ icuDataDir }),
    )

    const rejected = cliFixture({
      env: { PGLITE_CONFIG: './bad.mjs' },
      configuration: { initdb: { dataDir: '/override' } },
    })
    expect(await runCli(['initdb', '-D', 'data'], rejected.runtime)).toBe(1)
    expect(rejected.stderr()).toContain('cannot override initdb.dataDir')
    expect(rejected.initdb).not.toHaveBeenCalled()
  })

  it.each([
    ['SIGTERM', 'smart'],
    ['SIGINT', 'fast'],
    ['SIGQUIT', 'immediate'],
  ] as const)('maps %s to %s shutdown', async (signal, mode) => {
    const signals = new FakeSignals()
    const server = new FakeServer()
    const fixture = cliFixture({ signals, server })
    const running = runCli(['server', '-D', 'data'], fixture.runtime)
    await signals.waitFor(signal)
    signals.emit(signal)
    expect(await running).toBe(0)
    expect(server.closeModes).toEqual([mode])
    expect(signals.listenerCount(signal)).toBe(0)
  })

  it('maps SIGHUP to reload without stopping the server', async () => {
    const signals = new FakeSignals()
    const server = new FakeServer()
    const fixture = cliFixture({ signals, server })
    const running = runCli(['postgres', '-D', 'data'], fixture.runtime)
    await signals.waitFor('SIGHUP')
    signals.emit('SIGHUP')
    expect(server.reloadCalls).toBe(1)
    signals.emit('SIGINT')
    expect(await running).toBe(0)
    expect(server.closeModes).toEqual(['fast'])
  })

  it('uses exit 2 for usage errors and exit 1 for host failures', async () => {
    const usage = cliFixture()
    expect(await runCli(['unknown'], usage.runtime)).toBe(2)
    expect(usage.stderr()).toContain('unknown command')

    const host = cliFixture({ serverStartupError: new Error('cannot bind') })
    expect(await runCli(['server', '-D', 'data'], host.runtime)).toBe(1)
    expect(host.stderr()).toContain('cannot bind')
  })
})

interface FixtureOptions {
  readonly initdbExitCode?: number
  readonly readyExitCode?: number
  readonly serverStartupError?: Error
  readonly signals?: FakeSignals
  readonly server?: FakeServer
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly configuration?: unknown
}

function cliFixture(options: FixtureOptions = {}) {
  const stdout = outputStream()
  const stderr = outputStream()
  const initdb = vi.fn(async () => ({ exitCode: options.initdbExitCode ?? 0 }))
  const runTool = vi.fn(async () => options.readyExitCode ?? 0)
  const createServer = vi.fn(async (_serverOptions: PGliteServerOptions) => {
    if (options.serverStartupError) throw options.serverStartupError
    return (options.server ?? new FakeServer()) as unknown as PGliteServer
  })
  const loadConfiguration = vi.fn(async () => options.configuration)
  const runtime: CliRuntime = {
    env: { LANG: 'C', PGUSER: 'postgres', ...options.env },
    cwd: '/test/cwd',
    stdin: Readable.from([]),
    stdout: stdout.stream,
    stderr: stderr.stream,
    signals: options.signals ?? new FakeSignals(),
    initdb,
    runTool,
    createServer,
    loadConfiguration,
  }
  return {
    runtime,
    initdb,
    runTool,
    createServer,
    loadConfiguration,
    stdout: stdout.text,
    stderr: stderr.text,
  }
}

class FakeSignals extends EventEmitter implements SignalSource {
  override on(signal: NodeJS.Signals, listener: () => void): this {
    return super.on(signal, listener)
  }

  override off(signal: NodeJS.Signals, listener: () => void): this {
    return super.off(signal, listener)
  }

  async waitFor(signal: NodeJS.Signals): Promise<void> {
    while (this.listenerCount(signal) === 0) {
      await new Promise((resolveWait) => setImmediate(resolveWait))
    }
  }
}

class FakeServer {
  readonly addresses = [
    { transport: 'tcp', host: '127.0.0.1', port: 5432 } as const,
  ]
  readonly closeModes: string[] = []
  reloadCalls = 0
  private resolveExit!: (exit: PGlitePostmasterExit) => void
  private readonly exit = new Promise<PGlitePostmasterExit>((resolveExit) => {
    this.resolveExit = resolveExit
  })
  readonly postmaster = {
    waitForExit: () => this.exit,
  }

  async close(options: { mode?: string } = {}): Promise<void> {
    this.closeModes.push(options.mode ?? 'smart')
    this.resolveExit({ exitKind: 0, exitCode: 0 })
  }

  reload(): void {
    this.reloadCalls++
  }
}

function outputStream(): { stream: PassThrough; text(): string } {
  const chunks: Buffer[] = []
  const stream = new PassThrough()
  stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
  return { stream, text: () => Buffer.concat(chunks).toString('utf8') }
}
