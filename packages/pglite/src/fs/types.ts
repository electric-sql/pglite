import type { EmPostgres, FS } from "../../release/postgres.js";
import type { DebugLevel } from "../index.js";

export type FsType = "nodefs" | "idbfs" | "memoryfs";

export interface FilesystemFactory {
  new (dataDir: string): Filesystem;
}

export interface Filesystem {
  init(debug?: DebugLevel): Promise<void>;
  emscriptenOpts(opts: Partial<EmPostgres>): Promise<Partial<EmPostgres>>;
  syncToFs(mod: FS): Promise<void>;
  initialSyncFs(mod: FS): Promise<void>;
}

export abstract class FilesystemBase implements Filesystem {
  protected dataDir?: string;
  constructor(dataDir?: string) {
    this.dataDir = dataDir;
  }
  abstract init(): Promise<void>;
  abstract emscriptenOpts(
    opts: Partial<EmPostgres>,
  ): Promise<Partial<EmPostgres>>;
  async syncToFs(mod: FS) {}
  async initialSyncFs(mod: FS) {}
}
