import { gzipSync } from 'node:zlib'
import { describe, expect, test } from 'vitest'
import {
  canonicalJson,
  PGLITE_EXTENSION_MANIFEST_PATH,
  sha256Hex,
  validateExtensionArtifactBytes,
} from '../src/extension-archive.js'
import {
  PGLITE_EXTENSION_ABI,
  PGLITE_EXTENSION_ARTIFACT_FORMAT_VERSION,
  PGLITE_HOST_ABI,
  type PGliteArtifactLimits,
  type PGliteExtensionArtifactDescriptor,
  type PGliteExtensionArtifactManifest,
} from '../src/extension-artifacts.js'

const encoder = new TextEncoder()
const target = {
  pointerWidth: 32 as const,
  memoryAddressWidth: 32 as const,
  topology: 'classic' as const,
  postgresMajor: 18,
  postgresAbi: 'postgres-18-wasm32-v1',
  pgliteExtensionAbi: PGLITE_EXTENSION_ABI,
  memoryAbi: 'pglite-classic-memory-v1',
  hostAbi: PGLITE_HOST_ABI,
}

interface TarEntry {
  path: string
  bytes?: Uint8Array
  type?: number
}

async function fixture(
  options: {
    entries?: TarEntry[]
    append?: TarEntry[]
    canonicalManifest?: boolean
  } = {},
): Promise<{
  descriptor: PGliteExtensionArtifactDescriptor
  archive: Uint8Array
}> {
  const sql = encoder.encode('CREATE EXTENSION test;\n')
  const manifest: PGliteExtensionArtifactManifest = {
    formatVersion: PGLITE_EXTENSION_ARTIFACT_FORMAT_VERSION,
    extensionName: 'test',
    extensionVersion: '1.0.0',
    target,
    artifactDependencies: [],
    postgresExtensions: [{ name: 'test', requires: [] }],
    files: [
      {
        path: 'share/extension/test.sql',
        size: sql.byteLength,
        sha256: await sha256Hex(sql),
        kind: 'sql',
      },
    ],
    sideModules: [],
    requiredSharedPreloadLibraries: [],
    processConfig: { pgliteEnv: {}, requiredHostCapabilities: [] },
    capabilities: {
      directSharedMemory: false,
      backgroundWorkers: false,
      parallelWorkers: false,
    },
  }
  const manifestText =
    options.canonicalManifest === false
      ? JSON.stringify(manifest, null, 2)
      : canonicalJson(manifest)
  const manifestBytes = encoder.encode(manifestText)
  const entries = options.entries ?? [
    { path: '.pglite', type: 53 },
    { path: 'share', type: 53 },
    { path: 'share/extension', type: 53 },
    { path: PGLITE_EXTENSION_MANIFEST_PATH, bytes: manifestBytes },
    { path: 'share/extension/test.sql', bytes: sql },
  ]
  const archive = new Uint8Array(
    gzipSync(tar([...entries, ...(options.append ?? [])])),
  )
  return {
    archive,
    descriptor: {
      targetKey: 'wasm32-classic',
      target,
      url: new URL('https://example.test/test.tar.gz'),
      archiveBytes: archive.byteLength,
      archiveSha256: await sha256Hex(archive),
      manifestSha256: await sha256Hex(encoder.encode(canonicalJson(manifest))),
      manifest,
    },
  }
}

describe('extension archive validation', () => {
  test('validates a canonical, exact, bounded archive', async () => {
    const { descriptor, archive } = await fixture()
    const result = await validateExtensionArtifactBytes(descriptor, archive)
    expect([...result.files]).toEqual([
      ['share/extension/test.sql', encoder.encode('CREATE EXTENSION test;\n')],
    ])
  })

  test('rejects a non-canonical internal manifest', async () => {
    const { descriptor, archive } = await fixture({ canonicalManifest: false })
    await expect(
      validateExtensionArtifactBytes(descriptor, archive),
    ).rejects.toThrow(/not canonically serialized/)
  })

  test.each([
    {
      name: 'traversal',
      entry: { path: '../escape', bytes: new Uint8Array() },
      error: /non-canonical/,
    },
    {
      name: 'absolute path',
      entry: { path: '/escape', bytes: new Uint8Array() },
      error: /non-canonical/,
    },
    {
      name: 'symlink',
      entry: { path: 'share/link', bytes: new Uint8Array(), type: 50 },
      error: /forbidden tar type/,
    },
    {
      name: 'hard link',
      entry: { path: 'share/link', bytes: new Uint8Array(), type: 49 },
      error: /forbidden tar type/,
    },
    {
      name: 'device',
      entry: { path: 'share/device', bytes: new Uint8Array(), type: 51 },
      error: /forbidden tar type/,
    },
    {
      name: 'undeclared regular file',
      entry: { path: 'share/extra', bytes: new Uint8Array() },
      error: /regular-file set/,
    },
    {
      name: 'undeclared directory',
      entry: { path: 'other', type: 53 },
      error: /undeclared directory/,
    },
  ])('rejects $name entries', async ({ entry, error }) => {
    const { descriptor, archive } = await fixture({ append: [entry] })
    await expect(
      validateExtensionArtifactBytes(descriptor, archive),
    ).rejects.toThrow(error)
  })

  test('rejects archive, expansion, file, and entry limits', async () => {
    const { descriptor, archive } = await fixture()
    const baseline: PGliteArtifactLimits = {
      maximumArchiveBytes: archive.byteLength,
      maximumExpandedBytes: 1024 * 1024,
      maximumEntries: 16,
      maximumFileBytes: 1024 * 1024,
    }
    await expect(
      validateExtensionArtifactBytes(descriptor, archive, {
        ...baseline,
        maximumArchiveBytes: archive.byteLength - 1,
      }),
    ).rejects.toThrow(/archive size .* exceeds limit/)
    await expect(
      validateExtensionArtifactBytes(descriptor, archive, {
        ...baseline,
        maximumExpandedBytes: 100,
      }),
    ).rejects.toThrow(/expanded-size limit/)
    await expect(
      validateExtensionArtifactBytes(descriptor, archive, {
        ...baseline,
        maximumEntries: 1,
      }),
    ).rejects.toThrow(/entry-count limit/)
    await expect(
      validateExtensionArtifactBytes(descriptor, archive, {
        ...baseline,
        maximumFileBytes: 5,
      }),
    ).rejects.toThrow(/per-file limit/)
  })

  test('rejects archive and contained-file digest mismatches', async () => {
    const { descriptor, archive } = await fixture()
    await expect(
      validateExtensionArtifactBytes(
        { ...descriptor, archiveSha256: '0'.repeat(64) },
        archive,
      ),
    ).rejects.toThrow(/archive digest mismatch/)

    const wrongFile = {
      ...descriptor,
      manifest: {
        ...descriptor.manifest,
        files: [{ ...descriptor.manifest.files[0], sha256: '0'.repeat(64) }],
      },
    }
    await expect(
      validateExtensionArtifactBytes(wrongFile, archive),
    ).rejects.toThrow(/internal manifest differs/)
  })
})

function tar(entries: TarEntry[]): Uint8Array {
  const chunks: Uint8Array[] = []
  for (const entry of entries) {
    const bytes = entry.bytes ?? new Uint8Array()
    const header = new Uint8Array(512)
    writeString(header, 0, 100, entry.path)
    writeOctal(header, 100, 8, entry.type === 53 ? 0o755 : 0o644)
    writeOctal(header, 108, 8, 0)
    writeOctal(header, 116, 8, 0)
    writeOctal(header, 124, 12, bytes.byteLength)
    writeOctal(header, 136, 12, 0)
    header.fill(32, 148, 156)
    header[156] = entry.type ?? 48
    writeString(header, 257, 6, 'ustar')
    writeString(header, 263, 2, '00')
    let checksum = 0
    for (const value of header) checksum += value
    writeOctal(header, 148, 8, checksum)
    chunks.push(header, bytes)
    const padding = (512 - (bytes.byteLength % 512)) % 512
    if (padding) chunks.push(new Uint8Array(padding))
  }
  chunks.push(new Uint8Array(1024))
  const length = chunks.reduce((total, chunk) => total + chunk.byteLength, 0)
  const output = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

function writeString(
  target: Uint8Array,
  offset: number,
  length: number,
  value: string,
): void {
  const bytes = encoder.encode(value)
  if (bytes.byteLength > length) throw new Error(`tar value too long: ${value}`)
  target.set(bytes, offset)
}

function writeOctal(
  target: Uint8Array,
  offset: number,
  length: number,
  value: number,
): void {
  const text = value.toString(8).padStart(length - 2, '0') + '\0 '
  target.set(encoder.encode(text), offset)
}
