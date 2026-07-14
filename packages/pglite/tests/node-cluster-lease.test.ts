import { fork, type ChildProcess } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, test } from 'vitest'
import {
  NodeClusterLeaseProvider,
  PGliteClusterInUseError,
} from '../src/fs/node-cluster-lease.js'

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

describe('NodeClusterLeaseProvider', () => {
  test('holds one authoritative lock and records diagnostic metadata', async () => {
    const dataDir = await temporaryDataDirectory()
    const provider = new NodeClusterLeaseProvider()
    const lease = await provider.acquireExclusiveClusterLease(dataDir, {
      ownerToken: 'first-owner',
      runtime: 'postmaster',
      startedAt: '2026-07-14T12:00:00.000Z',
    })
    expect(await readdir(dataDir)).toEqual([])

    await expect(
      provider.acquireExclusiveClusterLease(dataDir, {
        ownerToken: 'second-owner',
        runtime: 'classic',
        startedAt: '2026-07-14T12:01:00.000Z',
      }),
    ).rejects.toMatchObject({
      name: 'PGliteClusterInUseError',
      owner: {
        ownerToken: 'first-owner',
        runtime: 'postmaster',
        pid: process.pid,
      },
    } satisfies Partial<PGliteClusterInUseError>)

    const metadata = JSON.parse(
      await readFile(
        join(dirname(dataDir), `.${basename(dataDir)}.pglite.lock`),
        'utf8',
      ),
    )
    expect(metadata).toMatchObject({
      ownerToken: 'first-owner',
      runtime: 'postmaster',
      pid: process.pid,
    })

    await lease.release()
    await lease.release()
    const nextLease = await provider.acquireExclusiveClusterLease(dataDir, {
      ownerToken: 'third-owner',
      runtime: 'classic',
      startedAt: '2026-07-14T12:02:00.000Z',
    })
    await nextLease.release()
  })

  test('the operating system releases ownership when its process dies', async () => {
    const dataDir = await temporaryDataDirectory()
    const child = fork(
      fileURLToPath(
        new URL('./fixtures/cluster-lease-holder.ts', import.meta.url),
      ),
      [dataDir, 'crashed-owner'],
      {
        execArgv: ['--import', 'tsx'],
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      },
    )
    children.add(child)
    await waitForChildMessage(child, 'ready')

    const provider = new NodeClusterLeaseProvider()
    await expect(
      provider.acquireExclusiveClusterLease(dataDir, {
        ownerToken: 'blocked-owner',
        runtime: 'postmaster',
        startedAt: new Date().toISOString(),
      }),
    ).rejects.toBeInstanceOf(PGliteClusterInUseError)

    child.kill('SIGKILL')
    await waitForExit(child)
    children.delete(child)

    const recovered = await provider.acquireExclusiveClusterLease(dataDir, {
      ownerToken: 'recovered-owner',
      runtime: 'postmaster',
      startedAt: new Date().toISOString(),
    })
    await recovered.release()
  })
})

async function temporaryDataDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'pglite-cluster-lease-'))
  temporaryDirectories.push(directory)
  return join(directory, 'pgdata')
}

function waitForChildMessage(child: ChildProcess, expected: string) {
  return new Promise<void>((resolvePromise, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      reject(new Error(`lease holder exited early (${code ?? signal})`))
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
