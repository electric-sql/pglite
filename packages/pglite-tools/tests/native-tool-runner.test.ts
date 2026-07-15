import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough, Readable } from 'node:stream'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createNativeToolRunner,
  PGliteToolHostError,
} from '../src/native-tool-runner.js'

const roots = new Set<string>()

afterEach(async () => {
  await Promise.all(
    [...roots].map((root) => rm(root, { recursive: true, force: true })),
  )
  roots.clear()
})

describe('native PostgreSQL tool runner', () => {
  it('rejects a copied or mismatched Wasm artifact before starting a Worker', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pglite-tool-identity-'))
    roots.add(root)
    const modulePath = join(root, 'tool.js')
    await writeFile(modulePath, 'export default async () => ({})')
    await writeFile(join(root, 'tool.wasm'), Uint8Array.of(0, 97, 115, 109))
    const runner = createNativeToolRunner(
      'test_tool',
      pathToFileURL(modulePath),
      { artifactSha256: '0'.repeat(64), buildId: 'test' },
    )

    await expect(
      runner.run({
        argv: [],
        env: {},
        stdin: Readable.from([]),
        stdout: new PassThrough(),
        stderr: new PassThrough(),
      }),
    ).rejects.toMatchObject<PGliteToolHostError>({
      name: 'PGliteToolHostError',
      message: expect.stringContaining('Incompatible test_tool Wasm artifact'),
    })
  })

  it('rejects invalid argv before reading an artifact', async () => {
    const runner = createNativeToolRunner(
      'test_tool',
      new URL('file:///does-not-exist/tool.js'),
      { artifactSha256: '0'.repeat(64), buildId: 'test' },
    )
    await expect(
      runner.run({
        argv: ['invalid\0argument'],
        env: {},
        stdin: Readable.from([]),
        stdout: new PassThrough(),
        stderr: new PassThrough(),
      }),
    ).rejects.toThrow('argv contains an invalid argument')
  })
})
