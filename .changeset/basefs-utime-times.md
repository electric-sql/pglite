---
'@electric-sql/pglite': patch
---

Fix custom filesystems not receiving times set with `FS.utime`. Emscripten's `FS.utime` calls `setattr` with `atime` and `mtime`, but the `BaseFilesystem` bridge only handled the older `timestamp` field, so `utimes` was never called on OPFS AHP or any other `BaseFilesystem`. Files restored from a tarball kept the time they were written instead of the time stored in the tarball.
