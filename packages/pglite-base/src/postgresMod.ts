// Types only - no actual implementation imported

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
  FS: FS
  FD_BUFFER_MAX: number
  WASM_PREFIX: string
  INITIAL_MEMORY: number
  pg_extensions: Record<string, Promise<Blob | null>>
  _use_wire: (state: number) => void
  _pgl_initdb: () => number
  _pgl_backend: () => void
  _pgl_shutdown: () => void
  _get_buffer_size: (fd: number) => number
  _get_buffer_addr: (fd: number) => number
  _get_channel: () => number
  _interactive_write: (msgLength: number) => void
  _interactive_one: () => void
  _interactive_read: () => number
}

export type PostgresFactory<T extends PostgresMod = PostgresMod> = (
  moduleOverrides?: Partial<T>,
) => Promise<T>
