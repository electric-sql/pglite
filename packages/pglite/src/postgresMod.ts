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
  FS: FS
  FD_BUFFER_MAX: number
  WASM_PREFIX: string
  INITIAL_MEMORY: number
  pg_extensions: Record<string, Promise<Blob | null>>
  _use_wire: (state: number) => void
  _pgl_initdb: () => number
  _pgl_backend: () => void
  _pgl_shutdown: () => void
  _interactive_write: (msgLength: number) => void
  _interactive_one: (length: number, peek: number) => void
  _interactive_read: () => number
  _set_read_write_cbs: (read_cb: number, write_cb: number) => void
}

type PostgresFactory<T extends PostgresMod = PostgresMod> = (
  moduleOverrides?: Partial<T>,
) => Promise<T>

export default PostgresModFactory as PostgresFactory<PostgresMod>
