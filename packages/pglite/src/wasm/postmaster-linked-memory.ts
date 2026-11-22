import { pglUtils } from '@electric-sql/pglite-utils'
import { linkMemory } from './linked-memory.js'

const modules = new Map<boolean, Promise<WebAssembly.Module>>()

function provider(shared: boolean) {
  let module = modules.get(shared)
  if (!module) {
    const url = shared
      ? new URL('../release/linked-shared.wasm', import.meta.url)
      : new URL('../release/linked-unshared.wasm', import.meta.url)
    module = pglUtils
      .getFsBundle(url)
      .then((bytes) => WebAssembly.compile(bytes))
    modules.set(shared, module)
    module.catch(() => modules.delete(shared))
  }
  return module
}

export function linkPostmasterMemory(
  privateHeap: WebAssembly.Memory,
  global: WebAssembly.Memory,
  scoped: WebAssembly.Memory,
  getProvider = provider,
) {
  return linkMemory(privateHeap, global, scoped, getProvider)
}
