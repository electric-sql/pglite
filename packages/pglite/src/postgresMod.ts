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
  FS: FS
  PROXYFS: Emscripten.FileSystemType
  WASM_PREFIX: string
  INITIAL_MEMORY: number
  pg_extensions: Record<string, Promise<Blob | null>>
  UTF8ToString: (ptr: number, maxBytesToRead?: number) => string
  stringToUTF8OnStack: (s: string) => number
  // _pgl_initdb: () => number
  // _pgl_backend: () => void
  _pgl_shutdown: () => void
  _pgl_set_system_fn: (system_fn: number) => void
  _pgl_set_popen_fn: (popen_fn: number) => void
  _pgl_set_pclose_fn: (pclose_fn: number) => void
  _pgl_interactive_one: (length: number, peek: number) => void
  _pgl_set_rw_cbs: (read_cb: number, write_cb: number) => void
  _pgl_set_pipe_fn: (pipe_fn: number) => number
  _pgl_freopen: (filepath: number, mode: number, stream: number) => number
  _fopen: (path: number, mode: number) => number
  _fclose: (stream: number) => number
  _fflush: (stream: number) => void
  _pgl_proc_exit: (code: number) => number
  ___funcs_on_exit: () => void
  // _pgl_startup: (args?: string[]) => number
  addFunction: (
    cb: (ptr: any, length: number) => void,
    signature: string,
  ) => number
  removeFunction: (f: number) => void
  callMain: (args?: string[]) => number
}

type PostgresFactory<T extends PostgresMod = PostgresMod> = (
  moduleOverrides?: Partial<T>,
) => Promise<T>

export default PostgresModFactory as PostgresFactory<PostgresMod>
