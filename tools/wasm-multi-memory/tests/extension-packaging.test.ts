import { execFile } from 'node:child_process'
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

const execute = promisify(execFile)
const roots: string[] = []
const tool = resolve(import.meta.dirname, '../extensions/package-extension.mjs')
const wrapperTool = resolve(
  import.meta.dirname,
  '../extensions/generate-wrapper.mjs',
)

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true })),
  )
})

describe('deterministic extension packaging', () => {
  it('emits byte-identical archives and descriptors from the same input', async () => {
    const root = await fixture()
    await packageFixture(root, 'first')
    await packageFixture(root, 'second')
    await expect(readFile(join(root, 'first.tar.gz'))).resolves.toEqual(
      await readFile(join(root, 'second.tar.gz')),
    )
    await expect(readFile(join(root, 'first.json'))).resolves.toEqual(
      await readFile(join(root, 'second.json')),
    )
  })

  it('rejects symbolic links that escape the input root', async () => {
    const root = await fixture()
    await symlink('/etc/passwd', join(root, 'input/share/extension/escape.sql'))
    await expect(packageFixture(root, 'unsafe')).rejects.toThrow(
      /unsafe symbolic link/,
    )
  })

  it('treats an explicit empty side-module list as authoritative', async () => {
    const root = await fixture()
    await mkdir(join(root, 'input/lib/postgresql'), { recursive: true })
    await writeFile(
      join(root, 'input/lib/postgresql/static_only.so'),
      new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]),
    )
    await packageFixture(root, 'static-only')
    const descriptor = JSON.parse(
      await readFile(join(root, 'static-only.json'), 'utf8'),
    )
    expect(descriptor.extensionManifest.sideModules).toEqual([])
    expect(descriptor.extensionManifest.files).toContainEqual(
      expect.objectContaining({
        path: 'lib/postgresql/static_only.so',
        kind: 'side-module',
      }),
    )
  })

  it('generates a complete wasm32-initial wrapper map', async () => {
    const root = await fixture()
    await packageFixture(root, 'classic')
    const configuration = JSON.parse(
      await readFile(join(root, 'config.json'), 'utf8'),
    )
    configuration.target.topology = 'multi-memory'
    configuration.target.memoryAbi = 'test-multi-memory-abi'
    await writeFile(join(root, 'config.json'), JSON.stringify(configuration))
    await packageFixture(root, 'multi-memory')

    const output = join(root, 'generated-artifacts.ts')
    await execute(process.execPath, [
      wrapperTool,
      output,
      `wasm32-classic=${join(root, 'classic.json')}=../release/test.wasm32-classic.tar.gz`,
      `wasm32-multi-memory=${join(root, 'multi-memory.json')}=../release/test.wasm32-multi-memory.tar.gz`,
    ])
    const generated = await readFile(output, 'utf8')
    expect(generated).toContain('releaseProfile: "wasm32-initial"')
    expect(generated).toContain(
      'targetKeys: ["wasm32-classic","wasm32-multi-memory"]',
    )
    expect(generated).toContain(
      'new URL("../release/test.wasm32-classic.tar.gz"',
    )
    expect(generated).toContain(
      'new URL("../release/test.wasm32-multi-memory.tar.gz"',
    )
  })
})

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'pglite-extension-package-'))
  roots.push(root)
  await mkdir(join(root, 'input/share/extension'), { recursive: true })
  await writeFile(
    join(root, 'input/share/extension/test.control'),
    "default_version = '1.0'\n",
  )
  await writeFile(
    join(root, 'input/share/extension/test--1.0.sql'),
    'SELECT 1;\n',
  )
  await writeFile(
    join(root, 'config.json'),
    JSON.stringify({
      extensionName: 'test',
      extensionVersion: '1.0.0',
      target: {
        pointerWidth: 32,
        memoryAddressWidth: 32,
        topology: 'classic',
        postgresMajor: 18,
        postgresAbi: 'test-postgres-abi',
        pgliteExtensionAbi: 'test-extension-abi',
        memoryAbi: 'test-memory-abi',
        hostAbi: 'test-host-abi',
      },
      sideModules: [],
    }),
  )
  return root
}

async function packageFixture(root: string, name: string): Promise<void> {
  await execute(process.execPath, [
    tool,
    join(root, 'config.json'),
    join(root, 'input'),
    join(root, `${name}.tar.gz`),
    join(root, `${name}.json`),
  ])
}
