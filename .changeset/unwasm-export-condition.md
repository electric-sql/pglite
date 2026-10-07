---
'@electric-sql/pglite': patch
---

Add an `unwasm` export condition for bundlers using [unwasm](https://github.com/unjs/unwasm), such as Nitro 3. It imports the Wasm modules and the FS bundle (as `pglite.data.wasm`) as modules, so they are included in the bundle.
