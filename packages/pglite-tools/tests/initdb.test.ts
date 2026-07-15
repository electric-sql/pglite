import { PassThrough, Readable } from 'node:stream'
import { pathToFileURL } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

const runInitdbRuntime = vi.hoisted(() => vi.fn())
const initdbRuntimeIdentity = vi.hoisted(() => ({
  coreVersion: '0.5.4',
  contract: 'initdb-runtime',
  abiVersion: 1,
}))

vi.mock('@electric-sql/pglite/_internal/initdb-runtime', () => ({
  initdbRuntimeIdentity,
  runInitdbRuntime,
}))

import { initdb } from '../src/initdb.js'

describe('initdb', () => {
  it('rejects an incompatible core runtime contract before invocation', async () => {
    initdbRuntimeIdentity.abiVersion = 2
    await expect(initdb({ dataDir: './pgdata' })).rejects.toThrow(
      'Incompatible @electric-sql/pglite initdb runtime',
    )
    expect(runInitdbRuntime).not.toHaveBeenCalled()
    initdbRuntimeIdentity.abiVersion = 1
  })

  it('preserves native argv and selects the supplied streams and environment', async () => {
    runInitdbRuntime.mockResolvedValueOnce({ exitCode: 7 })
    const stdin = Readable.from(['password\n'])
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    const signal = new AbortController().signal
    const result = await initdb({
      dataDir: './relative-pgdata',
      args: ['--encoding=LATIN1', '--auth-host=scram-sha-256'],
      env: { LANG: 'C', PGLITE_INITDB_TEST: 'present' },
      stdin,
      stdout,
      stderr,
      signal,
    })

    expect(result.exitCode).toBe(7)
    expect(result.dataDir.href).toBe(
      pathToFileURL(`${process.cwd()}/relative-pgdata`).href,
    )
    expect(runInitdbRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        argv: ['--encoding=LATIN1', '--auth-host=scram-sha-256'],
        env: expect.objectContaining({
          LANG: 'C',
          PGLITE_INITDB_TEST: 'present',
        }),
        stdin,
        stdout,
        stderr,
        signal,
      }),
    )
  })

  it('accepts matching -D forms and rejects conflicting paths', async () => {
    runInitdbRuntime.mockResolvedValue({ exitCode: 0 })
    const dataDir = pathToFileURL(`${process.cwd()}/matching-pgdata`)
    await expect(
      initdb({ dataDir, args: ['-D', dataDir.pathname] }),
    ).resolves.toMatchObject({ exitCode: 0 })
    await expect(
      initdb({ dataDir, args: ['--pgdata=./somewhere-else'] }),
    ).rejects.toThrow('conflicts with PostgreSQL argument')
  })

  it('rejects non-file URLs without invoking core', async () => {
    runInitdbRuntime.mockClear()
    await expect(initdb({ dataDir: new URL('idb://cluster') })).rejects.toThrow(
      'file: scheme',
    )
    expect(runInitdbRuntime).not.toHaveBeenCalled()
  })
})
