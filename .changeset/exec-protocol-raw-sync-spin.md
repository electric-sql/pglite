---
'@electric-sql/pglite': patch
---

Fix `execProtocolRawSync` spinning forever at 100% CPU when the WASM backend terminates mid-message (e.g. `exit(1)` after hitting EOF during a `COPY ... FROM STDIN`). Non-longjmp exceptions from the protocol loop are now rethrown instead of silently swallowed, so the call rejects with the backend error and subsequent calls fail fast instead of hanging (#1058).
