export const IN_NODE =
  typeof process === 'object' &&
  typeof process.versions === 'object' &&
  typeof process.versions.node === 'string'

export async function dataDir(): Promise<Blob> {
  const moduleUrl = new URL('../release/prepopulatedfs.tgz', import.meta.url)
  if (IN_NODE) {
    const fs = await import('fs/promises')
    const buffer = await fs.readFile(moduleUrl)
    return new Blob([new Uint8Array(buffer)])
  } else {
    const wasmDownloadPromise = await fetch(moduleUrl)
    return wasmDownloadPromise.blob()
  }
}
