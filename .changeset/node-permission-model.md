---
'@electric-sql/pglite': patch
---

Start under the Node.js permission model (`node --permission`). Emscripten's NODEFS read the fs open flags with `process.binding('constants')`, which Node always denies in that mode, so `new PGlite()` threw `ERR_ACCESS_DENIED` even for `memory://`. The bundled build now reads them from `require('fs').constants`, which holds the same values.
