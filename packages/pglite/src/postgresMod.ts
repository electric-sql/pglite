//@ts-ignore
import PostgresModFactory from "../release/postgres.js";

// Uses the types from @types/emscripten

export type FS = typeof FS & {
  filesystems: {
    MEMFS: Emscripten.FileSystemType;
    NODEFS: Emscripten.FileSystemType;
    IDBFS: Emscripten.FileSystemType;
  };
};

export interface PostgresMod
  extends Omit<EmscriptenModule, "preInit" | "preRun" | "postRun"> {
  preInit: Array<{ (mod: PostgresMod): void }>;
  preRun: Array<{ (mod: PostgresMod): void }>;
  postRun: Array<{ (mod: PostgresMod): void }>;
  FS: FS;
  WASM_PREFIX: string;
  pg_extensions: Record<string, Promise<Blob | null>>;
  _pg_initdb: () => number;
  _interactive_write: (msgLength: number) => void;
  _interactive_one: () => void;
  _interactive_read: () => number;
}

type PostgresFactory<T extends PostgresMod = PostgresMod> = (
  moduleOverrides?: Partial<T>,
) => Promise<T>;

export default PostgresModFactory as PostgresFactory<PostgresMod>;
