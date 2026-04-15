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
  ENV: Record<string, string>
  _pgl_set_send_fn: (send_fn: number) => number
  _pgl_set_recv_fn: (recv_fn: number) => number
  addFunction: (fn: CallableFunction, signature: string) => number
  removeFunction: (f: number) => void
  onExit: (status: number) => void
  print: (test: string) => void
  printErr: (text: string) => void
  callMain: (args?: string[]) => number
}

type PgDumpFactory<T extends PgDumpMod = PgDumpMod> = (
  moduleOverrides?: Partial<T>,
) => Promise<T>

export default PgDumpModFactory as PgDumpFactory<PgDumpMod>
