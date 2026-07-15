import { describe, expect, test } from 'vitest'
import {
  PGLITE_EXTENSION_ABI,
  PGLITE_EXTENSION_ARTIFACT_FORMAT_VERSION,
  PGLITE_HOST_ABI,
  PGLITE_RELEASE_PROFILES,
  PGLITE_WASM_TARGET_KEYS,
  PGliteExtensionArtifactError,
  assertExtensionHostCapabilities,
  releaseProfileIsComplete,
  resolveArtifactUrl,
  selectExactTarget,
  targetKeyFor,
  validateArtifactDescriptor,
  type PGliteExtensionArtifactDescriptor,
  type PGliteMemoryTopology,
  type PGlitePointerWidth,
  type PGliteWasmTarget,
  type PGliteWasmTargetKey,
} from '../src/extension-artifacts.js'

const sha = (digit: string) => digit.repeat(64)

function target(targetKey: PGliteWasmTargetKey): PGliteWasmTarget {
  const [, widthText, topologyText] =
    /^(wasm32|wasm64)-(classic|faceted|multi-memory)$/.exec(targetKey)!
  const pointerWidth = Number(widthText.slice(4)) as PGlitePointerWidth
  const topology = topologyText as PGliteMemoryTopology
  return {
    pointerWidth,
    memoryAddressWidth: pointerWidth,
    topology,
    postgresMajor: 18,
    postgresAbi: `postgres-18-wasm${pointerWidth}-v1`,
    pgliteExtensionAbi: PGLITE_EXTENSION_ABI,
    memoryAbi:
      topology === 'classic'
        ? `pglite-classic-memory${pointerWidth}-v1`
        : `pglite-${topology}-memory${pointerWidth}-v1`,
    hostAbi: PGLITE_HOST_ABI,
  }
}

function descriptor(
  targetKey: PGliteWasmTargetKey,
): PGliteExtensionArtifactDescriptor {
  const artifactTarget = target(targetKey)
  return {
    targetKey,
    target: artifactTarget,
    url: new URL(`https://example.test/vector.${targetKey}.tar.gz`),
    archiveBytes: 123,
    archiveSha256: sha('a'),
    manifestSha256: sha('b'),
    manifest: {
      formatVersion: PGLITE_EXTENSION_ARTIFACT_FORMAT_VERSION,
      extensionName: 'vector',
      extensionVersion: '1.0.0',
      target: artifactTarget,
      artifactDependencies: [],
      postgresExtensions: [{ name: 'vector', requires: [] }],
      files: [
        {
          path: 'lib/vector.so',
          size: 12,
          sha256: sha('c'),
          kind: 'side-module',
        },
      ],
      sideModules: [
        {
          logicalName: 'vector',
          path: 'lib/vector.so',
          sha256: sha('c'),
          wasmAbiSection: 'pglite.multi-memory.abi',
          importsHash: sha('d'),
          loadAfter: [],
        },
      ],
      requiredSharedPreloadLibraries: [],
      processConfig: {
        pgliteEnv: { VECTOR_DATA: { artifactPath: 'lib/vector.so' } },
        requiredHostCapabilities: [],
      },
      capabilities: {
        directSharedMemory: targetKey.includes('multi-memory'),
        backgroundWorkers: false,
        parallelWorkers: false,
      },
    },
  }
}

describe('extension artifact targets', () => {
  test('represents and validates every reserved target key', () => {
    for (const targetKey of PGLITE_WASM_TARGET_KEYS) {
      const value = descriptor(targetKey)
      expect(() => validateArtifactDescriptor(value)).not.toThrow()
      expect(targetKeyFor(value.target)).toBe(targetKey)
    }
  })

  test('defines partial release profiles without nearest-target substitution', () => {
    expect(PGLITE_RELEASE_PROFILES['wasm32-initial']).toEqual([
      'wasm32-classic',
      'wasm32-multi-memory',
    ])
    expect(
      releaseProfileIsComplete('wasm32-initial', {
        'wasm32-classic': descriptor('wasm32-classic'),
      }),
    ).toBe(false)
    expect(
      releaseProfileIsComplete('wasm32-initial', {
        'wasm32-classic': descriptor('wasm32-classic'),
        'wasm32-multi-memory': descriptor('wasm32-multi-memory'),
      }),
    ).toBe(true)
  })

  test('selects only an exact target supported by every extension', () => {
    const classic = descriptor('wasm32-classic')
    const multiMemory = descriptor('wasm32-multi-memory')
    expect(
      selectExactTarget(
        [
          {
            targetKey: 'wasm32-multi-memory',
            target: multiMemory.target,
          },
          { targetKey: 'wasm32-classic', target: classic.target },
        ],
        [
          { artifacts: { 'wasm32-classic': classic } },
          {
            artifacts: {
              'wasm32-classic': classic,
              'wasm32-multi-memory': multiMemory,
            },
          },
        ],
      ).targetKey,
    ).toBe('wasm32-classic')
  })

  test('fails clearly when registered extensions have no common target', () => {
    const multiMemory = descriptor('wasm32-multi-memory')
    expect(() =>
      selectExactTarget(
        [
          {
            targetKey: 'wasm32-multi-memory',
            target: multiMemory.target,
          },
        ],
        [{ artifacts: { 'wasm32-classic': descriptor('wasm32-classic') } }],
      ),
    ).toThrowError(PGliteExtensionArtifactError)
  })
})

describe('extension artifact validation', () => {
  test('rejects target metadata drift', () => {
    const value = descriptor('wasm32-classic')
    expect(() =>
      validateArtifactDescriptor({
        ...value,
        targetKey: 'wasm32-multi-memory',
      }),
    ).toThrow(/does not match structured target/)
  })

  test.each([
    '../lib/vector.so',
    '/lib/vector.so',
    'lib//vector.so',
    'lib/./vector.so',
    'lib\\vector.so',
  ])('rejects non-canonical archive path %s', (path) => {
    const value = descriptor('wasm32-classic')
    expect(() =>
      validateArtifactDescriptor({
        ...value,
        manifest: {
          ...value.manifest,
          files: [{ ...value.manifest.files[0], path }],
        },
      }),
    ).toThrow(/non-canonical artifact path/)
  })

  test('rejects process configuration paths outside artifact ownership', () => {
    const value = descriptor('wasm32-classic')
    expect(() =>
      validateArtifactDescriptor({
        ...value,
        manifest: {
          ...value.manifest,
          processConfig: {
            pgliteEnv: { VECTOR_DATA: { artifactPath: 'share/missing.dat' } },
            requiredHostCapabilities: [],
          },
        },
      }),
    ).toThrow(/not owned by the artifact/)
  })
})

describe('artifact location overrides', () => {
  test('uses complete descriptor, extension locator, runtime locator, then default', () => {
    const original = descriptor('wasm32-classic')
    const request = {
      extensionName: 'vector',
      extensionVersion: '1.0.0',
      targetKey: original.targetKey,
      descriptor: original,
    } as const
    const replacement = {
      ...original,
      url: new URL('https://replacement.test/vector.tar.gz'),
      archiveSha256: sha('e'),
    }

    expect(
      resolveArtifactUrl(
        request,
        {
          artifact: replacement,
          locateArtifact: () => new URL('https://extension.test/ignored'),
        },
        () => new URL('https://runtime.test/ignored'),
      ),
    ).toBe(replacement)
    expect(
      resolveArtifactUrl(
        request,
        { locateArtifact: () => new URL('https://extension.test/vector') },
        () => new URL('https://runtime.test/ignored'),
      ).url.href,
    ).toBe('https://extension.test/vector')
    expect(
      resolveArtifactUrl(
        request,
        undefined,
        () => new URL('https://runtime.test/vector'),
      ).url.href,
    ).toBe('https://runtime.test/vector')
    expect(resolveArtifactUrl(request, undefined, undefined).url).toBe(
      original.url,
    )
  })

  test('does not let a complete descriptor override change target', () => {
    const original = descriptor('wasm32-classic')
    expect(() =>
      resolveArtifactUrl(
        {
          extensionName: 'vector',
          extensionVersion: '1.0.0',
          targetKey: original.targetKey,
          descriptor: original,
        },
        { artifact: descriptor('wasm32-multi-memory') },
        undefined,
      ),
    ).toThrow(/does not match wasm32-classic/)
  })
})

describe('extension host capabilities', () => {
  test('rejects a missing declared capability', () => {
    expect(() =>
      assertExtensionHostCapabilities(['gpu'], new Set(['node'])),
    ).toThrow(/gpu/)
  })

  test('accepts an exact available capability set', () => {
    expect(() =>
      assertExtensionHostCapabilities(
        ['node', 'worker-threads'],
        new Set(['node', 'worker-threads']),
      ),
    ).not.toThrow()
  })
})
