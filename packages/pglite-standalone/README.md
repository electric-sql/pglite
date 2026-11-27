# PGlite standalone

PGlite built as a WASI module without the emscripten JS glue, so that it can be embedded from other languages through any WASI runtime (Wasmtime, Wasmer, `node:wasi`, ...), e.g. as a throwaway Postgres in test suites. It is the same single-user backend as PGlite, with the same limitations.

This package is private. It contains a reference host for Node (`src/`: `StandalonePGlite` mirrors the `PGlite` class, and `initdb()` creates a data directory), its tests, and in `release/` the output of `pnpm wasm:build:standalone`: `pglite-standalone.wasm`, `initdb-standalone.wasm` and the runtime filesystem `pglite-standalone-fs.tar.gz`.

The module uses native wasm exceptions (exnref): enable `wasm_exceptions` in Wasmtime, or pass `--experimental-wasm-exnref` to Node 22+.

## Host interface

### Imports

| Import                                | Signature                                                  |                                                                                              |
| ------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `wasi_snapshot_preview1.*`            |                                                            | stdio, environment, clock and random. No preopened directories: the filesystem is in memory. |
| `pglite.read`                         | `(ptr: i32, max_len: i32) -> i32`                          | Copy up to `max_len` bytes of frontend protocol data to `ptr`; return the count.             |
| `pglite.write`                        | `(ptr: i32, len: i32) -> i32`                              | Consume `len` bytes of backend protocol data at `ptr`; return `len`.                         |
| `pglite.exec`                         | `(command: i32, stdin_path: i32, stdout_path: i32) -> i32` | Run a subprocess (see below); return its exit code, or -1 if it cannot run.                  |
| `env.emscripten_notify_memory_growth` | `(i32) -> ()`                                              | Can be a no-op.                                                                              |

`pglite.exec` redirects the command's stdin and stdout from and to files in the instance's filesystem (0 for none). initdb uses it to run `postgres`: run each command in a fresh postgres instance, copying PGDATA in and back out (see `src/initdb.ts`). Postgres itself only runs `locale -a`: answer with the contents of `/pglite/locale-a`.

Give instances an empty stdin, e.g. `/dev/null`: some Postgres commands read it.

### Exports

In addition to `memory`, `malloc` and `free`:

| Export                                                                                              |                                                                                |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `_initialize()`                                                                                     | WASI reactor initialization; call first.                                       |
| `pgl_fs_load_tar(prefix, buf, len) -> i32`                                                          | Unpack an uncompressed tarball under `prefix`. Returns 0, or a negative errno. |
| `pgl_setPGliteActive(1)`                                                                            | Call before `pgl_call_main`.                                                   |
| `pgl_call_main(argc, argv) -> i32`                                                                  | Run `main()`. Returns its return value or exit status.                         |
| `pgl_startPGlite()`                                                                                 | Finish setting up the backend, after `pgl_call_main`.                          |
| `pgl_getMyProcPort() -> i32`, `ProcessStartupPacket(port, cancel_req) -> i32`, `pgl_sendConnData()` | Handle the client startup packet.                                              |
| `pgl_loop_once() -> i32`                                                                            | Process one frontend message. Returns -1, or the exit status if it exited.     |
| `pgl_longjmp_recover() -> i32`                                                                      | Recover from an error. Returns -1, or the exit status if it exited.            |
| `pq_buffer_remaining_data() -> i32`                                                                 | Bytes read from the host but not yet processed.                                |
| `PostgresSendReadyForQueryIfNecessary()`, `pgl_pq_flush()`                                          | Finish a response.                                                             |

`src/instance.ts` uses a few more `pgl_fs_*` exports to copy files in and out, e.g. for initdb.

Like the JS build, PGlite returns control to its host with `exit()`: 99 (`PGLITE_EXIT_ALIVE`) once the backend is ready, and 100 (`POSTGRES_MAIN_LONGJMP`) on an error.

### Protocol

**Startup**

1. Instantiate the module and call `_initialize()`.
2. With `pgl_fs_load_tar`, unpack `pglite-standalone-fs.tar.gz` at `/` and a data directory (from `initdb()`, or `PGlite.dumpDataDir()`) at `/pglite/data`.
3. Set the environment as in `defaultEnv` (`src/defaults.ts`).
4. Call `pgl_setPGliteActive(1)`, then `pgl_call_main()` with `/pglite/bin/postgres`, `defaultStartParams`, `-D /pglite/data` and the database name. It returns 99 once the backend is ready.
5. Call `pgl_startPGlite()`.

**Messages**

Pass whole frontend messages; whatever the module passes to `pglite.write` during the call is the response.

- **Startup packet** (first byte 0): call `ProcessStartupPacket(pgl_getMyProcPort(), cancel_req)` (0 is success), where `cancel_req` points to 512 zeroed bytes, then `pgl_sendConnData()` and `pgl_pq_flush()`.
- **Terminate** (`X`): ignore it.
- **Anything else**: while the message has not all been read, or `pq_buffer_remaining_data() > 0`, call `pgl_loop_once()`, and `pgl_longjmp_recover()` when it returns 100 (any other status but -1 is an error). Then call `PostgresSendReadyForQueryIfNecessary()` and `pgl_pq_flush()`.

Instances are independent, so a host can run several side by side.

## Limitations

- Extensions are linked in at build time (currently plpgsql, ltree, btree_gist and pgtap); nothing is loaded dynamically.
- There are no signals, so `statement_timeout`, `lock_timeout` and similar settings never fire.
- Name resolution only handles numeric addresses.
- Everything is in memory.
