---
'@electric-sql/pglite': patch
---

Fix files restored from a tarball getting a January 1970 modification time. `loadTar` passed the tar header's time to Emscripten's `FS.utime` in seconds, but `FS.utime` takes milliseconds. This affected every new database (initdb's data dir is restored from a tarball) and every `loadDataDir`. With the Node filesystem the files on disk got those dates too.
