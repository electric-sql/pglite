import { describe, expect, test } from 'vitest'
import { defineExtension } from '../src/extension.js'
import { getExtensionArtifactOverride } from '../src/extension.js'
import { prepareExtensionSet } from '../src/extension-registry.js'
import {
  PGLITE_EXTENSION_ABI,
  PGLITE_EXTENSION_ARTIFACT_FORMAT_VERSION,
  PGLITE_HOST_ABI,
  type PGliteExtensionArtifactDescriptor,
  type PGliteExtensionArtifactManifest,
  type PGliteWasmTarget,
} from '../src/extension-artifacts.js'

const digest = (value: string) => value.repeat(64)
const runtimeTarget: PGliteWasmTarget = {
  pointerWidth: 32,
  memoryAddressWidth: 32,
  topology: 'multi-memory',
  postgresMajor: 18,
  postgresAbi: 'postgres-18-wasm32-v1',
  pgliteExtensionAbi: PGLITE_EXTENSION_ABI,
  memoryAbi: 'pglite-tagged-i32-v1',
  hostAbi: PGLITE_HOST_ABI,
}

function artifact(
  name: string,
  options: {
    version?: string
    dependencies?: PGliteExtensionArtifactManifest['artifactDependencies']
    files?: PGliteExtensionArtifactManifest['files']
    sideModules?: PGliteExtensionArtifactManifest['sideModules']
    pgliteEnv?: PGliteExtensionArtifactManifest['processConfig']['pgliteEnv']
    preloads?: readonly string[]
  } = {},
): PGliteExtensionArtifactDescriptor {
  const version = options.version ?? '1.0.0'
  const files = options.files ?? [
    {
      path: `lib/${name}.so`,
      size: 1,
      sha256: digest(name === 'a' ? 'a' : 'b'),
      kind: 'side-module' as const,
    },
  ]
  const sideModules = options.sideModules ?? [
    {
      logicalName: name,
      path: files[0].path,
      sha256: files[0].sha256,
      wasmAbiSection: 'pglite.multi-memory.abi',
      importsHash: digest('c'),
      loadAfter: [],
    },
  ]
  return {
    targetKey: 'wasm32-multi-memory',
    target: runtimeTarget,
    url: new URL(`https://example.test/${name}.tar.gz`),
    archiveBytes: 10,
    archiveSha256: digest('d'),
    manifestSha256: digest('e'),
    manifest: {
      formatVersion: PGLITE_EXTENSION_ARTIFACT_FORMAT_VERSION,
      extensionName: name,
      extensionVersion: version,
      target: runtimeTarget,
      artifactDependencies: options.dependencies ?? [],
      postgresExtensions: [{ name, requires: [] }],
      files,
      sideModules,
      requiredSharedPreloadLibraries: options.preloads ?? [],
      processConfig: {
        pgliteEnv: options.pgliteEnv ?? {},
        requiredHostCapabilities: [],
      },
      capabilities: {
        directSharedMemory: true,
        backgroundWorkers: false,
        parallelWorkers: false,
      },
    },
  }
}

function extension(
  name: string,
  descriptor = artifact(name),
  dependsOn: readonly string[] = [],
) {
  return defineExtension({
    name,
    version: descriptor.manifest.extensionVersion,
    dependsOn,
    backend: { artifacts: { 'wasm32-multi-memory': descriptor } },
  })
}

function prepare(extensions: Record<string, ReturnType<typeof extension>>) {
  return prepareExtensionSet(extensions, {
    targetKey: 'wasm32-multi-memory',
    target: runtimeTarget,
    reservedNamespaces: new Set(['close']),
    coreProcessConfigKeys: new Set(['PGDATA']),
  })
}

describe('defineExtension', () => {
  test('creates immutable independently configured wrappers', () => {
    const base = extension('a')
    const configured = base.configure({
      locateArtifact: () => new URL('https://self-hosted.test/a.tar.gz'),
    })
    expect(configured).not.toBe(base)
    expect(Object.isFrozen(configured)).toBe(true)
    expect(getExtensionArtifactOverride(base)).toBeUndefined()
    expect(getExtensionArtifactOverride(configured)?.locateArtifact).toBeTypeOf(
      'function',
    )
  })
})

describe('prepareExtensionSet', () => {
  test('orders dependencies, side modules, preloads, and configuration', () => {
    const a = artifact('a', {
      preloads: ['a'],
      pgliteEnv: { SHARED: 'same', A_DATA: { artifactPath: 'lib/a.so' } },
    })
    const b = artifact('b', {
      dependencies: [{ extensionName: 'a', versionRange: '^1.0.0' }],
      preloads: ['a', 'b'],
      pgliteEnv: { SHARED: 'same', B: true },
      sideModules: [
        {
          logicalName: 'b',
          path: 'lib/b.so',
          sha256: digest('b'),
          wasmAbiSection: 'pglite.multi-memory.abi',
          importsHash: digest('c'),
          loadAfter: ['a:a'],
        },
      ],
    })
    const result = prepare({
      b: extension('b', b, ['a']),
      a: extension('a', a),
    })
    expect(result.extensions.map(({ extension }) => extension.name)).toEqual([
      'a',
      'b',
    ])
    expect(result.sideModuleOrder).toEqual(['a:a', 'b:b'])
    expect(result.requiredSharedPreloadLibraries).toEqual(['a', 'b'])
    expect(result.pgliteEnv).toEqual({
      SHARED: 'same',
      A_DATA: { artifactPath: 'lib/a.so' },
      B: true,
    })
  })

  test('allows identical co-owned files and rejects conflicting contents', () => {
    const shared = {
      path: 'share/common.dat',
      size: 1,
      sha256: digest('f'),
      kind: 'data' as const,
    }
    const a = artifact('a', { files: [shared], sideModules: [] })
    const b = artifact('b', { files: [shared], sideModules: [] })
    expect(
      prepare({ a: extension('a', a), b: extension('b', b) }).fileOwners,
    ).toMatchObject(new Map([['share/common.dat', ['a', 'b']]]))

    const conflict = artifact('b', {
      files: [{ ...shared, sha256: digest('0') }],
      sideModules: [],
    })
    expect(() =>
      prepare({ a: extension('a', a), b: extension('b', conflict) }),
    ).toThrow(/artifact file conflict/)
  })

  test('uses semver-compatible zero-major dependency ranges', () => {
    const dependent = artifact('b', {
      dependencies: [{ extensionName: 'a', versionRange: '^0.2.0' }],
    })
    expect(() =>
      prepare({
        a: extension('a', artifact('a', { version: '0.2.9' })),
        b: extension('b', dependent),
      }),
    ).not.toThrow()
    expect(() =>
      prepare({
        a: extension('a', artifact('a', { version: '0.3.0' })),
        b: extension('b', dependent),
      }),
    ).toThrow(/requires a@\^0\.2\.0/)
  })

  test.each([
    {
      name: 'missing wrapper dependency',
      build: () => prepare({ b: extension('b', artifact('b'), ['a']) }),
      error: /depends on missing extension a/,
    },
    {
      name: 'duplicate backend identity',
      build: () => prepare({ first: extension('a'), second: extension('a') }),
      error: /registered as both/,
    },
    {
      name: 'reserved namespace',
      build: () => prepare({ close: extension('a') }),
      error: /namespace is reserved/,
    },
    {
      name: 'process configuration conflict',
      build: () =>
        prepare({
          a: extension('a', artifact('a', { pgliteEnv: { VALUE: 'a' } })),
          b: extension('b', artifact('b', { pgliteEnv: { VALUE: 'b' } })),
        }),
      error: /configuration conflict/,
    },
    {
      name: 'core process configuration key',
      build: () =>
        prepare({
          a: extension('a', artifact('a', { pgliteEnv: { PGDATA: 'bad' } })),
        }),
      error: /core-owned key PGDATA/,
    },
  ])('rejects $name', ({ build, error }) => {
    expect(build).toThrow(error)
  })
})
