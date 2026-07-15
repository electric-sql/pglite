import { describe, expect, it } from 'vitest'
import {
  createClusterManifestFromFiles,
  PGliteClusterCompatibilityError,
  validateClusterFiles,
} from '../src/cluster-manifest.js'
import { pgliteRuntimeIdentity } from '../src/runtime-identity.js'

const artifact = pgliteRuntimeIdentity.artifacts.classic
const systemIdentifier = 12_345_678_901_234_567n

describe('cluster manifest compatibility', () => {
  it('derives and validates a manifest from authoritative native files', () => {
    const files = nativeFiles()
    const manifest = createClusterManifestFromFiles(files, {
      artifact,
      pgliteVersion: pgliteRuntimeIdentity.pgliteVersion,
      blockSize: pgliteRuntimeIdentity.blockSize,
      walBlockSize: pgliteRuntimeIdentity.walBlockSize,
      argv: ['--no-data-checksums', '--encoding=LATIN1'],
    })
    expect(manifest).toMatchObject({
      postgresMajor: 18,
      catalogVersion: artifact.catalogVersion,
      systemIdentifier: systemIdentifier.toString(),
      dataChecksums: false,
      encoding: 'LATIN1',
      createdByBuildId: artifact.buildId,
    })
    expect(
      validateClusterFiles(
        { ...files, manifest: JSON.stringify(manifest) },
        artifact,
        pgliteRuntimeIdentity.blockSize,
        pgliteRuntimeIdentity.walBlockSize,
      ),
    ).toEqual(manifest)
  })

  it('checks native metadata before reporting a missing manifest', () => {
    expect(() =>
      validateClusterFiles(
        { ...nativeFiles(), pgVersion: '17\n' },
        artifact,
        pgliteRuntimeIdentity.blockSize,
        pgliteRuntimeIdentity.walBlockSize,
      ),
    ).toThrow(/major 17 is incompatible/)
  })

  it('fails closed for missing and inconsistent manifests', () => {
    expect(() =>
      validateClusterFiles(
        nativeFiles(),
        artifact,
        pgliteRuntimeIdentity.blockSize,
        pgliteRuntimeIdentity.walBlockSize,
      ),
    ).toThrow(PGliteClusterCompatibilityError)

    const manifest = createClusterManifestFromFiles(nativeFiles(), {
      artifact,
      pgliteVersion: pgliteRuntimeIdentity.pgliteVersion,
      blockSize: pgliteRuntimeIdentity.blockSize,
      walBlockSize: pgliteRuntimeIdentity.walBlockSize,
      argv: [],
    })
    expect(() =>
      validateClusterFiles(
        {
          ...nativeFiles(),
          manifest: JSON.stringify({ ...manifest, systemIdentifier: '1' }),
        },
        artifact,
        pgliteRuntimeIdentity.blockSize,
        pgliteRuntimeIdentity.walBlockSize,
      ),
    ).toThrow(/system identifier/)
  })
})

function nativeFiles(): { pgVersion: string; control: Uint8Array } {
  const control = new Uint8Array(32)
  const view = new DataView(control.buffer)
  view.setBigUint64(0, systemIdentifier, true)
  view.setUint32(12, artifact.catalogVersion, true)
  return { pgVersion: '18\n', control }
}
