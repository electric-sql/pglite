import { openSync } from 'node:fs'
import { WASI } from 'node:wasi'
import { gunzipSync } from 'node:zlib'

/**
 * One instance of pglite-standalone.wasm or initdb-standalone.wasm: provides
 * their imports, and wraps the exports for the filesystem and main().
 * Instantiation is synchronous, so that initdb.ts can create an instance from
 * inside a host import.
 */

// WASI errno values, which the pgl_fs_* functions return negated
const WASI_ENOENT = 44

// node:wasi defaults stdin to the process's own, so a postgres that reads
// stdin (e.g. one of initdb's subprocesses) would wait for it forever
let devNull: number | undefined

/** The pglite.* host imports; addresses are in the instance's memory */
export interface HostFunctions {
  /** Copy up to max bytes of frontend protocol data to ptr; return the count */
  read?: (ptr: number, max: number) => number
  /** Consume len bytes of backend protocol data at ptr; return len */
  write?: (ptr: number, len: number) => number
  /** Run a command, stdin/stdout redirected from/to files (0 for none); return its exit code or -1 */
  exec?: (command: number, stdinPath: number, stdoutPath: number) => number
}

export interface InstanceOptions extends HostFunctions {
  env: Record<string, string>
  /** File descriptors for the instance's stdout and stderr (default: ours) */
  stdout?: number
  stderr?: number
}

interface Exports {
  memory: WebAssembly.Memory
  malloc(size: number): number
  free(ptr: number): void
  pgl_fs_load_tar(prefix: number, tar: number, len: number): number
  pgl_fs_dump_tar(path: number, tar: number, len: number): number
  pgl_fs_read_file(path: number, data: number, len: number): number
  pgl_fs_write_file(
    path: number,
    buf: number,
    len: number,
    mode: number,
  ): number
  pgl_fs_remove_tree(path: number): number
  pgl_freopen(path: number, mode: number, stream: number): number
  pgl_call_main(argc: number, argv: number): number
}

export class Instance {
  readonly exports: Exports

  constructor(module: WebAssembly.Module, opts: InstanceOptions) {
    const wasi = new WASI({
      version: 'preview1',
      env: opts.env,
      stdin: (devNull ??= openSync('/dev/null', 'r')),
      stdout: opts.stdout,
      stderr: opts.stderr,
    })
    const instance = new WebAssembly.Instance(module, {
      wasi_snapshot_preview1: wasi.wasiImport,
      env: { emscripten_notify_memory_growth: () => {} },
      pglite: {
        read: opts.read ?? (() => 0),
        write: opts.write ?? ((_ptr: number, len: number) => len),
        exec: opts.exec ?? this.#exec.bind(this),
      },
    })
    this.exports = instance.exports as unknown as Exports
    wasi.initialize(instance)
  }

  /** The default pglite.exec: Postgres only runs `locale -a`, which we answer like pglite.ts does */
  #exec(command: number, _stdinPath: number, stdoutPath: number): number {
    if (this.string(command).trim() === 'locale -a' && stdoutPath) {
      this.writeFile(this.string(stdoutPath), this.readFile('/pglite/locale-a'))
      return 0
    }
    return -1
  }

  get heap(): Uint8Array {
    // a fresh view each time: the memory can grow
    return new Uint8Array(this.exports.memory.buffer)
  }

  /** Copy data into a new malloc'd buffer */
  alloc(data: Uint8Array): number {
    const ptr = this.exports.malloc(Math.max(data.length, 1))
    this.heap.set(data, ptr)
    return ptr
  }

  cstr(s: string): number {
    return this.alloc(new TextEncoder().encode(s + '\0'))
  }

  string(ptr: number): string {
    const heap = this.heap
    const end = heap.indexOf(0, ptr)
    return new TextDecoder().decode(heap.subarray(ptr, end))
  }

  #withString<T>(s: string, fn: (ptr: number) => T): T {
    const ptr = this.cstr(s)
    try {
      return fn(ptr)
    } finally {
      this.exports.free(ptr)
    }
  }

  #check(rc: number, what: string) {
    if (rc !== 0) throw new Error(`${what} failed (errno ${-rc})`)
  }

  /** Call one of the pgl_fs_* functions that return a malloc'd buffer */
  #callReturningBuffer(
    fn: (path: number, data: number, len: number) => number,
    path: string,
    missingOk = false,
  ): Uint8Array | undefined {
    const out = this.exports.malloc(8) // char **, size_t *
    try {
      const rc = this.#withString(path, (p) => fn(p, out, out + 4))
      if (missingOk && rc === -WASI_ENOENT) return undefined
      this.#check(rc, `reading ${path}`)
      const [ptr, len] = new Uint32Array(this.exports.memory.buffer, out, 2)
      const data = this.heap.slice(ptr, ptr + len)
      this.exports.free(ptr)
      return data
    } finally {
      this.exports.free(out)
    }
  }

  /** Unpack a tarball (optionally gzipped) into the filesystem under prefix */
  loadTar(tarball: Uint8Array, prefix: string) {
    const tar =
      tarball[0] === 0x1f && tarball[1] === 0x8b ? gunzipSync(tarball) : tarball
    const buf = this.alloc(tar)
    try {
      const rc = this.#withString(prefix, (p) =>
        this.exports.pgl_fs_load_tar(p, buf, tar.length),
      )
      this.#check(rc, `loading ${prefix}`)
    } finally {
      this.exports.free(buf)
    }
  }

  /** The contents of directory path as an uncompressed tarball */
  dumpTar(path: string): Uint8Array
  dumpTar(path: string, missingOk: true): Uint8Array | undefined
  dumpTar(path: string, missingOk = false): Uint8Array | undefined {
    return this.#callReturningBuffer(
      this.exports.pgl_fs_dump_tar,
      path,
      missingOk,
    )
  }

  readFile(path: string): Uint8Array {
    return this.#callReturningBuffer(this.exports.pgl_fs_read_file, path)!
  }

  writeFile(path: string, data: Uint8Array, mode = 0o600) {
    const buf = this.alloc(data)
    try {
      const rc = this.#withString(path, (p) =>
        this.exports.pgl_fs_write_file(p, buf, data.length, mode),
      )
      this.#check(rc, `writing ${path}`)
    } finally {
      this.exports.free(buf)
    }
  }

  /** Like rm -rf */
  removeTree(path: string) {
    this.#check(
      this.#withString(path, (p) => this.exports.pgl_fs_remove_tree(p)),
      `removing ${path}`,
    )
  }

  /** Redirect stdin (0) or stdout (1) to a file, as initdb.ts does */
  freopen(path: string, mode: string, stream: 0 | 1) {
    const p = this.cstr(path)
    const m = this.cstr(mode)
    const file = this.exports.pgl_freopen(p, m, stream)
    this.exports.free(p)
    this.exports.free(m)
    if (!file) throw new Error(`cannot redirect stream ${stream} to ${path}`)
  }

  /** Call main(args); return its return value or exit status */
  callMain(args: string[]): number {
    const ptrs = args.map((a) => this.cstr(a))
    const argv = this.exports.malloc(4 * (ptrs.length + 1))
    new Uint32Array(this.exports.memory.buffer, argv, ptrs.length + 1).set([
      ...ptrs,
      0,
    ])
    // argv stays allocated: Postgres keeps pointers into it
    return this.exports.pgl_call_main(args.length, argv)
  }
}
