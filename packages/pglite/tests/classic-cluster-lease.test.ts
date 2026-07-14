import { fork, type ChildProcess } from 'node:child_process'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, test } from 'vitest'
import { PGlite } from '../dist/index.js'

const temporaryDirectories: string[] = []
const children = new Set<ChildProcess>()

afterEach(async () => {
  for (const child of children) child.kill('SIGKILL')
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

describe('classic persistent cluster ownership', () => {
  test('rejects a concurrent owner and releases after durable shutdown', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pglite-classic-lease-'))
    temporaryDirectories.push(root)
    const dataDir = join(root, 'pgdata')
    const first = await PGlite.create(`file://${dataDir}`)
    const versionBefore = await stat(join(dataDir, 'PG_VERSION'))

    await expect(PGlite.create(`file://${dataDir}`)).rejects.toMatchObject({
      name: 'PGliteClusterInUseError',
      owner: { runtime: 'classic', pid: process.pid },
    })
    const versionAfter = await stat(join(dataDir, 'PG_VERSION'))
    expect(versionAfter.mtimeMs).toBe(versionBefore.mtimeMs)

    await first.close()
    const reopened = await PGlite.create(`file://${dataDir}`)
    expect((await reopened.query('select 42 as answer')).rows).toEqual([
      { answer: 42 },
    ])
    await reopened.close()
  })

  test('releases only after tearing down a failed initialization', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pglite-classic-failure-'))
    temporaryDirectories.push(root)
    const dataDir = join(root, 'pgdata')

    await expect(
      PGlite.create({
        dataDir: `file://${dataDir}`,
        loadDataDir: new Blob(['not a tar archive']),
      }),
    ).rejects.toThrow()

    const recovered = await PGlite.create(`file://${dataDir}`)
    expect((await recovered.query('select 1 as value')).rows).toEqual([
      { value: 1 },
    ])
    await recovered.close()
  })

  test('recovers the real classic runtime lease after a process crash', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pglite-classic-crash-'))
    temporaryDirectories.push(root)
    const dataDir = join(root, 'pgdata')
    const child = fork(
      fileURLToPath(
        new URL('./fixtures/classic-cluster-holder.mjs', import.meta.url),
      ),
      [dataDir],
      { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] },
    )
    children.add(child)
    await waitForChildMessage(child, 'ready')

    await expect(PGlite.create(`file://${dataDir}`)).rejects.toMatchObject({
      name: 'PGliteClusterInUseError',
      owner: { runtime: 'classic', pid: child.pid },
    })

    child.kill('SIGKILL')
    await waitForExit(child)
    children.delete(child)

    const recovered = await PGlite.create(`file://${dataDir}`)
    expect((await recovered.query('select 1 as value')).rows).toEqual([
      { value: 1 },
    ])
    await recovered.close()
  })
})

function waitForChildMessage(child: ChildProcess, expected: string) {
  return new Promise<void>((resolvePromise, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      reject(new Error(`classic holder exited early (${code ?? signal})`))
    })
    child.on('message', (message) => {
      if (message === expected) resolvePromise()
    })
  })
}

function waitForExit(child: ChildProcess) {
  return new Promise<void>((resolvePromise, reject) => {
    child.once('error', reject)
    child.once('exit', () => resolvePromise())
  })
}
