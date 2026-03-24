export const IN_NODE =
  typeof process === 'object' &&
  typeof process.versions === 'object' &&
  typeof process.versions.node === 'string'

let wasmDownloadPromise = new Map<string, Promise<Response>>()

export async function startWasmDownload(path: string) {
  if (IN_NODE || wasmDownloadPromise.has(path)) {
    return
  }
  const moduleUrl = new URL(path, import.meta.url)
  wasmDownloadPromise.set(path, fetch(moduleUrl))
}

// This is a global cache of the PGlite Wasm module to avoid having to re-download or
// compile it on subsequent calls.
let cachedWasmModule: WebAssembly.Module | undefined

export async function instantiateWasm(
  imports: WebAssembly.Imports,
  modulePath: string,
  module?: WebAssembly.Module,
): Promise<{
  instance: WebAssembly.Instance
  module: WebAssembly.Module
}> {
  if (module || cachedWasmModule) {
    return {
      instance: await WebAssembly.instantiate(
        module || cachedWasmModule!,
        imports,
      ),
      module: module || cachedWasmModule!,
    }
  }
  const moduleUrl = new URL(modulePath, import.meta.url)
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
    if (!wasmDownloadPromise.has(moduleUrl.toString())) {
      wasmDownloadPromise.set(moduleUrl.toString(), fetch(moduleUrl))
    }
    const response = await wasmDownloadPromise.get(moduleUrl.toString())
    const { module: newModule, instance } =
      await WebAssembly.instantiateStreaming(response!, imports)
    cachedWasmModule = newModule
    return {
      instance,
      module: newModule,
    }
  }
}

export async function getFsBundle(path: '../release/pglite.data'): Promise<ArrayBuffer> {
  const fsBundleUrl = new URL(path, import.meta.url)
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

/**
 * Postgresql handles quoted names as CaseSensitive and unquoted as lower case.
 * If input is quoted, returns an unquoted string (same casing)
 * If input is unquoted, returns a lower-case string
 */
export function toPostgresName(input: string): string {
  let output
  if (input.startsWith('"') && input.endsWith('"')) {
    // Postgres sensitive case
    output = input.substring(1, input.length - 1)
  } else {
    // Postgres case insensitive - all to lower
    output = input.toLowerCase()
  }
  return output
}

