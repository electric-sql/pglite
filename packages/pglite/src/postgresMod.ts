import PostgresModFactory from '../release/postgres.js'

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
  WASM_PREFIX: string
  INITIAL_MEMORY: number
  pg_extensions: Record<string, Promise<Blob | null>>
  _pg_initdb: () => number
  _pg_shutdown: () => void
  _interactive_write: (msgLength: number) => void
  _interactive_one: () => void
  _interactive_read: () => number
}

type PostgresFactory<T extends PostgresMod = PostgresMod> = (
  moduleOverrides?: Partial<T>,
) => Promise<T>

const PGLITE_VERSION = 'v0.2.11'

const PostgresModFactoryWithVersion: PostgresFactory<PostgresMod> = async (
  moduleOverrides = {},
) => {
  const mod = await PostgresModFactory(moduleOverrides)
  mod.preRun.push((mod) => {
    mod.FS.writeFile(
      '/confdefs.h',
      `#define PG_VERSION_STR "PostgreSQL $PG_VERSION (PGlite ${PGLITE_VERSION}) on $host, compiled by $cc_string, \`expr $ac_cv_sizeof_void_p * 8\`-bit"`
    )
  })
  return mod
}

export default PostgresModFactoryWithVersion
