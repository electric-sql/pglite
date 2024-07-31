import type { PostgresMod, FS } from "../postgresMod.js";

export type FsType =
  | "nodefs"
  | "idbfs"
  | "memoryfs"
  | "opfs-worker"
  | "opfs-ahp";

export interface FilesystemFactory {
  new (dataDir: string): Filesystem;
}

export interface Filesystem {
  /**
   * Returns the options to pass to the emscripten module.
   */
  emscriptenOpts(opts: Partial<PostgresMod>): Promise<Partial<PostgresMod>>;

  /**
   * Sync the filesystem to the emscripten filesystem.
   */
  syncToFs(mod: FS, relaxedDurability?: boolean): Promise<void>;

  /**
   * Sync the emscripten filesystem to the filesystem.
   */
  initialSyncFs(FS: FS): Promise<void>;

  /**
   * Dump the PGDATA dir from the filesystem to a gziped tarball.
   */
  dumpTar(FS: FS, dbname: string): Promise<File | Blob>;

  /**
   * Close the filesystem.
   */
  close(): Promise<void>;
}

export abstract class FilesystemBase implements Filesystem {
  protected dataDir?: string;
  constructor(dataDir?: string) {
    this.dataDir = dataDir;
  }
  abstract emscriptenOpts(
    opts: Partial<PostgresMod>,
  ): Promise<Partial<PostgresMod>>;
  async syncToFs(mod: FS, relaxedDurability?: boolean) {}
  async initialSyncFs(mod: FS) {}
  abstract dumpTar(mod: FS, dbname: string): Promise<File | Blob>;
  async close() {}
}
