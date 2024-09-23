import type { PGliteInterface, Transaction } from './interface.js'

export const IN_NODE =
  typeof process === 'object' &&
  typeof process.versions === 'object' &&
  typeof process.versions.node === 'string'

let wasmDownloadPromise: Promise<Response> | undefined

export async function startWasmDownload() {
  if (IN_NODE) {
    return
  }
  const moduleUrl = new URL('../release/postgres.wasm', import.meta.url)
  wasmDownloadPromise = fetch(moduleUrl)
}

// This is a global cache of the PGlite Wasm module to avoid having to re-download or
// compile it on subsequent calls.
let cachedWasmModule: WebAssembly.Module | undefined

export async function instantiateWasm(
  imports: WebAssembly.Imports,
  module?: WebAssembly.Module,
): Promise<{
  instance: WebAssembly.Instance
  module: WebAssembly.Module
}> {
  if (module || cachedWasmModule) {
    WebAssembly.instantiate(module || cachedWasmModule!, imports)
    return {
      instance: await WebAssembly.instantiate(
        module || cachedWasmModule!,
        imports,
      ),
      module: module || cachedWasmModule!,
    }
  }
  const moduleUrl = new URL('../release/postgres.wasm', import.meta.url)
  if (IN_NODE) {
    const fs = await import('fs/promises')
    const buffer = await fs.readFile(moduleUrl)
    const { module: newModule, instance } = await WebAssembly.instantiate(
      buffer,
      imports,
    )
    cachedWasmModule = newModule
    return {
      instance,
      module: newModule,
    }
  } else {
    if (!wasmDownloadPromise) {
      wasmDownloadPromise = fetch(moduleUrl)
    }
    const response = await wasmDownloadPromise
    const { module: newModule, instance } =
      await WebAssembly.instantiateStreaming(response, imports)
    cachedWasmModule = newModule
    return {
      instance,
      module: newModule,
    }
  }
}

export async function getFsBundle(): Promise<ArrayBuffer> {
  const fsBundleUrl = new URL('../release/postgres.data', import.meta.url)
  if (IN_NODE) {
    const fs = await import('fs/promises')
    const fileData = await fs.readFile(fsBundleUrl)
    return fileData.buffer
  } else {
    const response = await fetch(fsBundleUrl)
    return response.arrayBuffer()
  }
}

export const uuid = (): string => {
  // best case, `crypto.randomUUID` is available
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID()
  }

  const bytes = new Uint8Array(16)

  if (globalThis.crypto?.getRandomValues) {
    // `crypto.getRandomValues` is available even in non-secure contexts
    globalThis.crypto.getRandomValues(bytes)
  } else {
    // fallback to Math.random, if the Crypto API is completely missing
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256)
    }
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x40 // Set the 4 most significant bits to 0100
  bytes[8] = (bytes[8] & 0x3f) | 0x80 // Set the 2 most significant bits to 10

  const hexValues: string[] = []
  bytes.forEach((byte) => {
    hexValues.push(byte.toString(16).padStart(2, '0'))
  })

  return (
    hexValues.slice(0, 4).join('') +
    '-' +
    hexValues.slice(4, 6).join('') +
    '-' +
    hexValues.slice(6, 8).join('') +
    '-' +
    hexValues.slice(8, 10).join('') +
    '-' +
    hexValues.slice(10).join('')
  )
}

export async function formatQuery(
  pg: PGliteInterface | Transaction,
  query: string,
  params?: any[] | null,
) {
  if (!params || params.length === 0) {
    // no params so no formatting needed
    return query
  }

  // replace $1, $2, etc with  %1L, %2L, etc
  const subbedQuery = query.replace(/\$([0-9]+)/g, (_, num) => {
    return '%' + num + 'L'
  })

  const ret = await pg.query<{
    query: string
  }>(
    `SELECT format($1, ${params.map((_, i) => `$${i + 2}`).join(', ')}) as query`,
    [subbedQuery, ...params],
    {
      setAllTypes: true,
    },
  )
  return ret.rows[0].query
}
