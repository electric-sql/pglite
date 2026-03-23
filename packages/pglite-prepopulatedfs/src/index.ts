import { readFile } from 'fs/promises'
import { resolve } from 'path'

export async function dataDir(): Promise<Blob> {
  const data = await readFile(
    resolve(__dirname, './prepopulatedfs.tgz'),
  )
  return new Blob([new Uint8Array(data)])
}
