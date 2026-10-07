import type { PGliteOptions } from './interface.js'

type DefaultOptions = Pick<
  PGliteOptions,
  'pgliteWasmModule' | 'initdbWasmModule' | 'fsBundle'
>

let defaultOptionsFn: (() => DefaultOptions) | undefined

/**
 * Set defaults for the Wasm modules and FS bundle, used by entry points that
 * import these artifacts as modules rather than loading them at runtime.
 */
export function setDefaultOptions(fn: () => DefaultOptions) {
  defaultOptionsFn = fn
}

export function getDefaultOptions(): DefaultOptions {
  return defaultOptionsFn?.() ?? {}
}
