// Re-export generic utilities from pglite-base
export {
  uuid,
  formatQuery,
  debounceMutex,
  toPostgresName,
  IN_NODE,
} from '@electric-sql/pglite-base'

// WebAssembly-specific utilities for pglite (not available in pglite-base)

let wasmDownloadPromise: Promise<Response> | undefined

export async function startWasmDownload() {
  if (IN_NODE || wasmDownloadPromise) {
    return
  }
  const moduleUrl = new URL('../release/pglite.wasm', import.meta.url)
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
    return {
      instance: await WebAssembly.instantiate(
        module || cachedWasmModule!,
        imports,
      ),
      module: module || cachedWasmModule!,
    }
  }
  const moduleUrl = new URL('../release/pglite.wasm', import.meta.url)
  if (IN_NODE) {
    const fs = await import('fs/promises')
    const { module: newModule, instance } = await WebAssembly.instantiate(
      await fs.readFile(moduleUrl),
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
  const fsBundleUrl = new URL('../release/pglite.data', import.meta.url)
  if (IN_NODE) {
    const fs = await import('fs/promises')
    const fileData = await fs.readFile(fsBundleUrl)
    return fileData.buffer
  } else {
    const response = await fetch(fsBundleUrl)
    return response.arrayBuffer()
  }
}