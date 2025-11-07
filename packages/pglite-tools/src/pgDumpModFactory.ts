import PgDumpModFactory from '../release/pg_dump'

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

export interface PgDumpMod
  extends Omit<EmscriptenModule, 'preInit' | 'preRun' | 'postRun'> {
  preInit: Array<{ (mod: PgDumpMod): void }>
  preRun: Array<{ (mod: PgDumpMod): void }>
  postRun: Array<{ (mod: PgDumpMod): void }>
  FS: FS
  WASM_PREFIX: string
  INITIAL_MEMORY: number
  _set_read_write_cbs: (read_cb: number, write_cb: number) => void
  addFunction: (
    cb: (ptr: any, length: number) => void,
    signature: string,
  ) => number
  removeFunction: (f: number) => void
  _main: (args: string[]) => number
  onExit: (status: number) => void
  print: (test: string) => void
  printErr: (text: string) => void
}

type PgDumpFactory<T extends PgDumpMod = PgDumpMod> = (
  moduleOverrides?: Partial<T>,
) => Promise<T>

export default PgDumpModFactory as PgDumpFactory<PgDumpMod>
