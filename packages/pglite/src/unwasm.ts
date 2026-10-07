// Entry point for bundlers using unwasm (https://github.com/unjs/unwasm), such
// as Nitro, resolved via the `unwasm` export condition.
// The Wasm modules and the FS bundle are imported as modules so that the
// bundler includes them, rather than them being loaded from files next to the
// bundle at runtime.
// `pglite.data.wasm` is generated at build time and holds `pglite.data` in a
// custom section of an otherwise empty Wasm module.
import pgliteWasmModule from '../release/pglite.wasm?module'
import initdbWasmModule from '../release/initdb.wasm?module'
import fsBundleWasmModule from '../release/pglite.data.wasm?module'
import { setDefaultOptions } from './defaultOptions.js'

setDefaultOptions(() => ({
  pgliteWasmModule,
  initdbWasmModule,
  fsBundle: new Blob(
    WebAssembly.Module.customSections(fsBundleWasmModule, 'pglite.data'),
  ),
}))

export * from './index.js'
