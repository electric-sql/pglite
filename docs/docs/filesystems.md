# Filesystems

PGlite has a virtual file system layer that allows it to run in environments that don't traditionally have filesystem access.

PGlite VFSs are under active development, and we plan to extend the range of options in future, as well as make it easy for users to create their own filesystems.

## In-memory FS

The in-memory FS is the default when starting PGlite, and it is available on all platforms. All files are kept in memory and there is no persistance, other than calling [`pg.dumpDataDir()`](./api.md#dumpdatadir) and then using the [`loadDataDir`](./api.md#options) option at start.

To use the in-memory FS you can use one of these methods:

- Don't provide a `dataDir` option
  ```ts
  const pg = new PGlite()
  ```
- Set the `dataDir` to `memory://`
  ```ts
  const pg = new PGlite("memory://")
  ```
- Import and pass the FS explicitly
  ```ts
  import { MemoryFS } from "@electric-sql/pglite";
  const pg = new PGlite({
    fs: new MemoryFS()
  })
  ```

### Platform Support

| Node | Bun | Chrome | Safari | Firefox |
|------|-----|--------|--------|---------|
| ✓    | ✓   | ✓      | ✓      | ✓       |

## Node FS

The Node FS uses the Node.js file system API to implement a VFS for PGLite. It is available in both Node and Bun.

To use the Node FS you can use one of these methods:

- Set the `dataDir` to a directory on your filesystem
  ```ts
  const pg = new PGlite("./path/to/datadir/")
  ```
- Import and pass the FS explicitly
  ```ts
  import { NodeFS } from "@electric-sql/pglite";
  const pg = new PGlite({
    fs: new NodeFS("./path/to/datadir/")
  })
  ```

#### Platform Support

| Node | Bun | Chrome | Safari | Firefox |
|------|-----|--------|--------|---------|
| ✓    | ✓   |        |        |         |

## IndexedDB FS

The IndexedDB FS persists the database to IndexedDB in the browser. It's a layer over the in-memory filesystem, loading all files for the database into memory on start, and flushing them to IndexedDB after each query if they have changed.

To use the IndexedDB FS you can use one of these methods:

- Set the `dataDir` with a `idb://` prefix, the database will be stored in an IndexedDB named with the path provided
  ```ts
  const pg = new PGlite("idb://my-database")
  ```
- Import and pass the FS explicitly
  ```ts
  import { IdbFs } from "@electric-sql/pglite";
  const pg = new PGlite({
    fs: new IdbFs("my-database")
  })
  ```

The IndexedDB filesystem works at the file level, storing whole files as blobs in IndexedDB. Flushing whole files can take a few milliseconds after each query. To aid in building responsive apps we provide a `relaxedDurability` mode that can be [configured when starting](./api.md#options) PGlite. Under this mode, the results of a query are returned immediately, and the flush to IndexedDB is scheduled to occur asynchronously afterwards. Typically, this is immediately after the query returns with no delay.

### Platform Support

| Node | Bun | Chrome | Safari | Firefox |
|------|-----|--------|--------|---------|
|      |     | ✓      | ✓      | ✓       |

## OPFS AHP FS

The OPFS AHP filesystem is built on top of the [Origin Private Filesystem](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system) in the browser and uses an "access handle pool". It is only available when PGlite is run in a Web Worker, this could be any worker you configure, however we provide a [Multi Tab Worker](./multi-tab-worker.md) to aid in using PGlite from multiple tabs in the browser.

To use the OPFS AHP FS you can use one of these methods:

- Set the `dataDir` to a directory within the origins OPFS
  ```ts
  const pg = new PGlite("opfs-ahp://path/to/datadir/")
  ```
- Import and pass the FS explicitly
  ```ts
  import { OpfsAhpFS } from "@electric-sql/pglite/opfs-ahp";
  const pg = new PGlite({
    fs: new OpfsAhpFS("./path/to/datadir/")
  })
  ```

### Platform Support

| Node | Bun | Chrome | Safari | Firefox |
|------|-----|--------|--------|---------|
|      |     | ✓      |        | ✓       |

Unfortunately, Safari appears to have a limit of 252 open sync access handles, this prevents this VFS from working due to a standard Postgres install consisting of over 300 files.

### What is an "access handle pool"?

The Origin Private Filesystem API provides both asynchronous and synchronous methods, but the synchronous methods are limited to read, write and flush. You are unable to traverse the filesystem or open files synchronously. PGlite is a fully synchronous WASM build of Postgres and unable to call async APIs while handling a query. While it is possible to build an async WASM Postgres using [Asyncify](https://emscripten.org/docs/porting/asyncify.html), it adds significant overhead in both file size and performance.

To overcome these limitations, and to provide a fully synchronous file system to PGlite on top of OPFS, we use something called an "access handle pool". When you first start PGlite we open a pool of OPFS access handles with randomised file names; these are then allocated to files as needed. After each query, a pool maintenance job is scheduled that maintains its size. When you inspect the OPFS directory where the database is stored, you will not see the normal Postgres directory layout, but rather a pool of files and a state file containing the directory tree mapping along with file metadata.

The PGlite OPFS AHP FS is inspired by the [wa-sqlite](https://github.com/rhashimoto/wa-sqlite) access handle pool file system by [Roy Hashimoto](https://github.com/rhashimoto).
