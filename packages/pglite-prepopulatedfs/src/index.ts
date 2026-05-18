import { pglUtils } from '@electric-sql/pglite-utils'

export async function dataDir(): Promise<Blob> {
  const moduleUrl = new URL('../dist/prepopulatedfs.tgz', import.meta.url)
  if (pglUtils.IN_NODE) {
    const fs = await import('fs/promises')
    const buffer = await fs.readFile(moduleUrl)
    return new Blob([new Uint8Array(buffer)])
  } else {
    const wasmDownloadPromise = await fetch(moduleUrl)
    return wasmDownloadPromise.blob()
  }
}
