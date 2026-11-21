import { RefreshingViews } from './multi-memory.js'
import { pglUtils } from '@electric-sql/pglite-utils'

import { PGLITE_LINKED_MEMORY_ABI } from '../extension-artifacts.js'

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

export async function linkMemory(
  privateHeap: WebAssembly.Memory,
  global: WebAssembly.Memory,
  scoped: WebAssembly.Memory,
  getProvider = provider,
) {
  const nodeBuffers = pglUtils.IN_NODE && typeof Buffer !== 'undefined'
  const heaps = [privateHeap, global, scoped].map(
    (heap) =>
      new RefreshingViews(
        heap,
        nodeBuffers ? (buffer) => Buffer.from(buffer) : undefined,
      ),
  )
  const bind = async (memory: WebAssembly.Memory) => {
    const shared =
      typeof SharedArrayBuffer !== 'undefined' &&
      memory.buffer instanceof SharedArrayBuffer
    const module = await getProvider(shared)
    return new WebAssembly.Instance(module, { env: { memory } }).exports
  }
  const globalOps = await bind(global)
  const scopedOps = global === scoped ? globalOps : await bind(scoped)
  const bulk: Record<string, (dst: number, src: number, n: number) => void> = {}
  for (const [d, dstHeap] of heaps.entries()) {
    for (const [s, srcHeap] of heaps.entries()) {
      if (s === d) continue
      // A single-memory Wasm instruction cannot copy between different heaps.
      // Keep native memmove semantics when two domains alias the same buffer.
      bulk['copy' + d + s] = (dst, src, n) => {
        dst >>>= 0
        src >>>= 0
        n >>>= 0
        const source = srcHeap.current.u8
        const destination = dstHeap.current.u8
        if (src + n > source.length || dst + n > destination.length) {
          throw new WebAssembly.RuntimeError('out of bounds linked memory.copy')
        }
        if (nodeBuffers) (source as Buffer).copy(destination, dst, src, src + n)
        else destination.set(source.subarray(src, src + n), dst)
      }
    }
  }
  return { pgl_global: globalOps, pgl_scoped: scopedOps, pgl_bulk: bulk }
}

export function sideModuleLinker(
  linked: WebAssembly.Imports,
  requireLinked: boolean,
) {
  return (
    binary: BufferSource | WebAssembly.Module,
    imports: WebAssembly.Imports,
  ) => {
    Object.assign(imports, linked)
    if (!requireLinked) return binary
    const module =
      binary instanceof WebAssembly.Module
        ? binary
        : new WebAssembly.Module(binary)
    assertLinkedModule(module)
    return module
  }
}

export function assertLinkedModule(module: WebAssembly.Module) {
  const sections = WebAssembly.Module.customSections(
    module,
    'pglite.linked-memory.abi',
  )
  const memories = WebAssembly.Module.imports(module).filter(
    (entry) => entry.kind === 'memory',
  )
  if (
    sections.length !== 1 ||
    new TextDecoder().decode(sections[0]) !== PGLITE_LINKED_MEMORY_ABI ||
    memories.length !== 1 ||
    memories[0].module !== 'env' ||
    memories[0].name !== 'memory'
  ) {
    throw new Error('Side module has incompatible linked-memory ABI')
  }
}
