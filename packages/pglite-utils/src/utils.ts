export const IN_NODE =
  typeof process === 'object' &&
  typeof process.versions === 'object' &&
  typeof process.versions.node === 'string'

export const PG_ROOT = '/pglite'
export const PGDATA = PG_ROOT + '/data'

export const initdbExePath = PG_ROOT + '/bin/initdb'
export const pgstdoutPath = PG_ROOT + '/pgstdout'
export const pgstdinPath = PG_ROOT + '/pgstdin'

const wasmDownloadPromises = new Map<URL, Promise<Response>>()

export async function startWasmDownload(url: URL) {
  if (IN_NODE || wasmDownloadPromises.has(url)) {
    return
  }
  wasmDownloadPromises.set(url, fetch(url))
}

// This is a global cache of the Wasm modules to avoid having to re-download or
// compile them on subsequent calls.
const cachedWasmModules = new Map<URL, WebAssembly.Module>()

function G(value: number, mutable: boolean): WebAssembly.Global {
  return new WebAssembly.Global({ value: 'i32', mutable }, value)
}

/**
 * Imports for an instance whose static data and stack are placed `delta`
 * bytes higher than where the Emscripten glue would put them.
 *
 * The other layout anchors (__heap_base, __stack_high, __stack_low) are
 * GOT.mem entries that the glue only resolves after instantiation; they are
 * moved by the caller once resolved (see getPostgresMod in pglite.ts).
 */
function shiftImports(imports: any, delta: number): WebAssembly.Imports {
  const env = {
    ...imports.env,
    __memory_base: G(imports.env.__memory_base.value + delta, false),
    __stack_pointer: G(imports.env.__stack_pointer.value + delta, true),
  }
  return { ...imports, env }
}

/**
 * The glue turns the data symbols exported by the main module into
 * addresses by adding the memory base it knows about. Move them by `delta`
 * first, so that it ends up with the addresses used by this instance.
 */
function shiftInstance(
  instance: WebAssembly.Instance,
  delta: number,
): WebAssembly.Instance {
  const exports: Record<string, any> = {}
  for (const [name, value] of Object.entries(instance.exports)) {
    exports[name] =
      value instanceof WebAssembly.Global
        ? G(value.value + delta, false)
        : value
  }
  return { exports } as WebAssembly.Instance
}

/**
 * @param memoryDelta when set, the instance is placed this many bytes higher
 * in the memory. Used to have several instances in one WebAssembly.Memory.
 */
export async function instantiateWasm(
  imports: WebAssembly.Imports,
  moduleUrl: URL,
  module?: WebAssembly.Module,
  memoryDelta?: number,
): Promise<{
  instance: WebAssembly.Instance
  module: WebAssembly.Module
  exports: any
}> {
  const eximports = memoryDelta ? shiftImports(imports, memoryDelta) : imports
  const result = await instantiate(eximports, moduleUrl, module)
  if (memoryDelta) {
    result.instance = shiftInstance(result.instance, memoryDelta)
    result.exports = result.instance.exports
  }
  return result
}

async function instantiate(
  eximports: WebAssembly.Imports,
  moduleUrl: URL,
  module?: WebAssembly.Module,
): Promise<{
  instance: WebAssembly.Instance
  module: WebAssembly.Module
  exports: any
}> {
  if (module || cachedWasmModules.has(moduleUrl)) {
    const mod = module || cachedWasmModules.get(moduleUrl)!
    const instance = await WebAssembly.instantiate(mod, eximports)
    return {
      instance,
      module: mod,
      exports: instance.exports,
    }
  }
  if (IN_NODE) {
    const fs = await import('fs/promises')
    const buffer = await fs.readFile(moduleUrl)
    const { module: newModule, instance } = await WebAssembly.instantiate(
      buffer,
      eximports,
    )
    cachedWasmModules.set(moduleUrl, newModule)
    return {
      instance,
      module: newModule,
      exports: instance.exports,
    }
  } else {
    if (!wasmDownloadPromises.has(moduleUrl)) {
      wasmDownloadPromises.set(moduleUrl, fetch(moduleUrl))
    }
    const response = await wasmDownloadPromises.get(moduleUrl)
    const { module: newModule, instance } =
      await WebAssembly.instantiateStreaming(response!, eximports)
    cachedWasmModules.set(moduleUrl, newModule)
    return {
      instance,
      module: newModule,
      exports: instance.exports,
    }
  }
}

export async function getFsBundle(fsBundleUrl: URL): Promise<ArrayBuffer> {
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
