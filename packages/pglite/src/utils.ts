import type { PGliteInterface, Transaction } from './interface.js'
import { serialize as serializeProtocol } from '@electric-sql/pg-protocol'
import { parseDescribeStatementResults } from './parse.js'
import { TEXT } from './types.js'

export const IN_NODE =
  typeof process === 'object' &&
  typeof process.versions === 'object' &&
  typeof process.versions.node === 'string'

let wasmDownloadPromise: Promise<Response> | undefined

export async function startWasmDownload() {
  if (IN_NODE || wasmDownloadPromise) {
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

/**
 * Formats a query with parameters
 * Expects that any tables/relations referenced in the query exist in the database
 * due to requiring them to be present to describe the parameters types.
 * `tx` is optional, and to be used when formatQuery is called during a transaction.
 * @param pg - The PGlite instance
 * @param query - The query to format
 * @param params - The parameters to format the query with
 * @param tx - The transaction to use, defaults to the PGlite instance
 * @returns The formatted query
 */
export async function formatQuery(
  pg: PGliteInterface,
  query: string,
  params?: any[] | null,
  tx?: Transaction | PGliteInterface,
) {
  if (!params || params.length === 0) {
    // no params so no formatting needed
    return query
  }

  tx = tx ?? pg

  // Get the types of the parameters
  let dataTypeIDs: number[]
  try {
    await pg.execProtocol(serializeProtocol.parse({ text: query }), {
      syncToFs: false,
    })

    dataTypeIDs = parseDescribeStatementResults(
      (
        await pg.execProtocol(serializeProtocol.describe({ type: 'S' }), {
          syncToFs: false,
        })
      ).messages,
    )
  } finally {
    await pg.execProtocol(serializeProtocol.sync(), { syncToFs: false })
  }

  // replace $1, $2, etc with  %1L, %2L, etc
  const subbedQuery = query.replace(/\$([0-9]+)/g, (_, num) => {
    return '%' + num + 'L'
  })

  const ret = await tx.query<{
    query: string
  }>(
    `SELECT format($1, ${params.map((_, i) => `$${i + 2}`).join(', ')}) as query`,
    [subbedQuery, ...params],
    { paramTypes: [TEXT, ...dataTypeIDs] },
  )
  return ret.rows[0].query
}
