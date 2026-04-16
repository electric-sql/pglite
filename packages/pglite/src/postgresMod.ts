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
  singleMode?: boolean
  preInit: Array<{ (mod: PostgresMod): void }>
  preRun: Array<{ (mod: PostgresMod): void }>
  postRun: Array<{ (mod: PostgresMod): void }>
  thisProgram: string
  stdin: (() => number | null) | null
  FS: FS
  setFS: (newFS: FS) => void
  wasmMemory: WebAssembly.Memory
  PROXYFS: Emscripten.FileSystemType
  PIPEFS: Emscripten.FileSystemType
  WASM_PREFIX: string
  pg_extensions: Record<string, Promise<Blob | null>>
  UTF8ToString: (ptr: number, maxBytesToRead?: number) => string
  stringToUTF8OnStack: (s: string) => number
  _pgl_set_system_fn: (system_fn: number) => void
  _pgl_set_popen_fn: (popen_fn: number) => void
  _pgl_set_pclose_fn: (pclose_fn: number) => void
  _pgl_set_send_fn: (send_fn: number) => number
  _pgl_set_recv_fn: (recv_fn: number) => number
  _pgl_set_pipe_fn: (pipe_fn: number) => number
  _pgl_set_fork_fn: (fork_fn: number) => number
  _pgl_set_kill_fn: (kill_fn: number) => number
  _pgl_set_waitpid_fn: (waitpid_fn: number) => number
  _pgl_set_sigaction_fn: (sigaction_fn: number) => number
  _pgl_set_signal_fn: (signal_fn: number) => number
  _pgl_set_getpid_fn: (getpid_fn: number) => number
  _pgl_set_socket_fn: (socket_fn: number) => number
  _pgl_set_bind_fn: (bind_fn: number) => number
  _pgl_set_listen_fn: (listen_fn: number) => number
  _pgl_set_accept_fn: (accept_fn: number) => number
  _pgl_set_close_fn: (close_fn: number) => number
  _pgl_set_poll_fn: (poll_fn: number) => number
  _pgl_freopen: (filepath: number, mode: number, stream: number) => number
  _pgl_pq_flush: () => void
  _fopen: (path: number, mode: number) => number
  _fclose: (stream: number) => number
  _fflush: (stream: number) => void
  _exit: (status: number) => void
  _pgl_proc_exit: (code: number) => number
  addFunction: (fn: CallableFunction, signature: string) => number
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
  _PostmasterServerLoopOnce(): () => void
  // althought the C function returns bool, we receive in JS a number
  _IsTransactionBlock: () => number
  _pgl_setPGliteActive: (newValue: number) => number
  _pgl_startPGlite: () => void
  _pgl_getMyProcPort: () => number
  _pgl_sendConnData: () => void
  ENV: any
  _emscripten_force_exit: (status: number) => void
  _pgl_run_atexit_funcs: () => void
  _pq_buffer_remaining_data: () => number
  _after_fork_inchild: () => void
  _after_fork_process_inchild: (
    child_type: number,
    startup_data: number,
    startup_data_len: number,
    client_sock: number,
  ) => void
  _hlp_pipe_replace: (prevFd: number, newFd: number) => number
  _hlp_trigger_new_connection: () => number
}

type PostgresFactory<T extends PostgresMod = PostgresMod> = (
  moduleOverrides?: Partial<T>,
) => Promise<T>

export default PostgresModFactory as PostgresFactory<PostgresMod>
