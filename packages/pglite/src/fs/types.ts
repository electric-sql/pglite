import type { EmPostgres, FS } from "../../release/postgres.js";
import type { DebugLevel } from "../index.js";

export type FsType = "nodefs" | "idbfs" | "memoryfs";

export interface FilesystemFactory {
  new (dataDir: string): Filesystem;
}

export interface Filesystem {
  /**
   * Returns true if the filesystem was initialized and this is the fun run.
   */
  init(debug?: DebugLevel): Promise<boolean>;

  /**
   * Returns the options to pass to the emscripten module.
   */
  emscriptenOpts(opts: Partial<EmPostgres>): Promise<Partial<EmPostgres>>;

  /**
   * Sync the filesystem to the emscripten filesystem.
   */
  syncToFs(mod: FS): Promise<void>;

  /**
   * Sync the emscripten filesystem to the filesystem.
   */
  initialSyncFs(mod: FS): Promise<void>;
}

export abstract class FilesystemBase implements Filesystem {
  protected dataDir?: string;
  constructor(dataDir?: string) {
    this.dataDir = dataDir;
  }
  abstract init(): Promise<boolean>;
  abstract emscriptenOpts(
    opts: Partial<EmPostgres>,
  ): Promise<Partial<EmPostgres>>;
  async syncToFs(mod: FS) {}
  async initialSyncFs(mod: FS) {}
}
