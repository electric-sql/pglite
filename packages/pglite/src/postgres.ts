//@ts-ignore
import EmPostgresFactory from "../release/postgres.js";

// Uses the types from @types/emscripten

export type FS = typeof FS & {
  filesystems: {
    MEMFS: Emscripten.FileSystemType,
    NODEFS: Emscripten.FileSystemType,
    IDBFS: Emscripten.FileSystemType,
    PGFS: Emscripten.FileSystemType,
  };
}

export interface EmPostgres extends Omit<EmscriptenModule,
  'preInit' | 'preRun' | 'postRun'
> {
  preInit: Array<{ (mod: EmPostgres): void }>;
  preRun: Array<{ (mod: EmPostgres): void }>;
  postRun: Array<{ (mod: EmPostgres): void }>;
  FS: FS;
}

type PostgresFactory<T extends EmPostgres = EmPostgres> = (
  moduleOverrides?: Partial<T>,
) => Promise<T>;

export default EmPostgresFactory as PostgresFactory<EmPostgres>;
