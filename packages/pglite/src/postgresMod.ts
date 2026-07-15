import PostgresModFactory from '../release/pglite'

type IDBFS = Emscripten.FileSystemType & {
  quit: () => void
  dbs: Record<string, IDBDatabase>
}

export type FS = typeof FS & {
  filesystems: {
    MEMFS: Emscripten.FileSystemType
    NODEFS: Emscripten.FileSystemType
    IDBFS: IDBFS
  }
  quit: () => void
}

export interface PostgresMod
  extends Omit<EmscriptenModule, 'preInit' | 'preRun' | 'postRun'> {
  preInit: Array<{ (mod: PostgresMod): void }>
  preRun: Array<{ (mod: PostgresMod): void }>
  postRun: Array<{ (mod: PostgresMod): void }>
  thisProgram: string
  stdin: (() => number | null) | null
  FS: FS
  wasmMemory: WebAssembly.Memory
  pgliteMemoryABI?: {
    readonly globalMemory: WebAssembly.Memory
    readonly scopedMemory: WebAssembly.Memory
  }
  PROXYFS: Emscripten.FileSystemType
  WASM_PREFIX: string
  pg_extensions: Record<string, Promise<Blob | null>>
  UTF8ToString: (ptr: number, maxBytesToRead?: number) => string
  stringToUTF8OnStack: (s: string) => number
  _pgl_set_system_fn: (system_fn: number) => void
  _pgl_set_popen_fn: (popen_fn: number) => void
  _pgl_set_pclose_fn: (pclose_fn: number) => void
  _pgl_set_rw_cbs: (read_cb: number, write_cb: number) => void
  _pgl_set_process_host: (
    spawn_backend: number,
    get_process_id: number,
    send_signal: number,
    wait_process: number,
  ) => void
  _pgl_set_signal_host: (
    poll_signals: number,
    set_signal_mask: number,
    set_timer: number,
  ) => void
  _pgl_set_futex_host: (wait_futex: number, wake_futex: number) => void
  _pgl_set_clock_host: (realtime_microseconds: number) => void
  _pgl_set_shmem_host: (ensure_capacity: number) => void
  _pgl_set_scoped_shmem_host: (ensure_capacity: number) => void
  _pgl_set_scoped_shmem_mode: (mode: number) => void
  _pgl_shm_scope_root: () => bigint
  _pgl_shm_registry_offset: () => number
  _pgl_shm_compact_frontier: () => number
  _pgl_heap_break: () => number
  _pgl_set_socket_host: (
    create_socket: number,
    connect_socket: number,
    bind_socket: number,
    listen_socket: number,
    accept_socket: number,
    close_socket: number,
    receive_socket: number,
    send_socket: number,
    poll_sockets: number,
    configure_unix_socket: number,
  ) => void
  _pgl_set_pipe_fn: (pipe_fn: number) => number
  _pgl_freopen: (filepath: number, mode: number, stream: number) => number
  _pgl_pq_flush: () => void
  _fopen: (path: number, mode: number) => number
  _fclose: (stream: number) => number
  _fflush: (stream: number) => void
  _pgl_proc_exit: (code: number) => number
  addFunction: (cb: CallableFunction, signature: string) => number
  removeFunction: (f: number) => void
  callMain: (args?: string[]) => number
  _PostgresMainLoopOnce: () => void
  _PostgresMainLongJmp: () => void
  _PostgresSendReadyForQueryIfNecessary: () => void
  _ProcessStartupPacket: (
    Port: number,
    ssl_done: boolean,
    gss_done: boolean,
  ) => number
  // althought the C function returns bool, we receive in JS a number
  _IsTransactionBlock: () => number
  _pgl_setPGliteActive: (newValue: number) => number
  _pgl_startPGlite: () => void
  _pgl_getMyProcPort: () => number
  _pgl_sendConnData: () => void
  ENV: any
  PGLITE_ENV: any
  _emscripten_force_exit: (status: number) => void
  _pgl_run_atexit_funcs: () => void
  _pq_buffer_remaining_data: () => number
  ___errno_location: () => number
}

type PostgresFactory<T extends PostgresMod = PostgresMod> = (
  moduleOverrides?: Partial<T>,
) => Promise<T>

export default PostgresModFactory as PostgresFactory<PostgresMod>
