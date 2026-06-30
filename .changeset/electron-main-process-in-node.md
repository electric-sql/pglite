---
'@electric-sql/pglite': patch
---

Detect the Node environment via `process.type` instead of `process.versions.electron`. The previous Electron guard (#951) also treated the Electron main and utility processes as non-Node, which broke PGlite's filesystem code path there. `process.type` only excludes Electron's web contexts (renderer, web worker, service worker), so PGlite keeps using the Node.js path in the Electron main and utility processes. Follow-up to #951 / #813.
