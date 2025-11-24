import InitdbModFactory from '../release/initdb'

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

export interface InitdbMod
  extends Omit<EmscriptenModule, 'preInit' | 'preRun' | 'postRun'> {
  preInit: Array<{ (mod: InitdbMod): void }>
  preRun: Array<{ (mod: InitdbMod): void }>
  postRun: Array<{ (mod: InitdbMod): void }>
  thisProgram: string
  ENV: Record<string,string>
  FS: FS
  PROXYFS: Emscripten.FileSystemType
  WASM_PREFIX: string
  INITIAL_MEMORY: number
  _pgl_set_rw_cbs: (read_cb: number, write_cb: number) => void
  _pgl_set_system_fn: (system_fn: number) => void
  _pgl_set_popen_fn: (popen_fn: number) => void
  _pgl_set_fgets_fn: (fgets_fn: number) => void
  addFunction: (
    fn: CallableFunction,
    signature: string,
  ) => number
  removeFunction: (f: number) => void
  callMain: (args: string[]) => number
  onExit: (status: number) => void
  print: (test: string) => void
  printErr: (text: string) => void
}

type PgDumpFactory<T extends InitdbMod = InitdbMod> = (
  moduleOverrides?: Partial<T>,
) => Promise<T>

export default InitdbModFactory as PgDumpFactory<InitdbMod>
