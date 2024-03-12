import type { EmPostgres, FS } from "../release/postgres.js";
import type { DebugLevel } from "./index.ts";
export const PGDATA = "/pgdata";

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

// Emscripten filesystem utility functions:

export function copyDir(fs: FS, src: string, dest: string) {
  const entries = fs.readdir(src);
  for (const name of entries) {
    if (name === "." || name === "..") continue;

    const srcPath = src + "/" + name;
    const destPath = dest + "/" + name;
    if (isDir(fs, srcPath)) {
      fs.mkdir(destPath);
      copyDir(fs, srcPath, destPath);
    } else {
      const data = fs.readFile(srcPath);
      fs.writeFile(destPath, data);
    }
  }
}

export function isDir(fs: FS, path: string) {
  return fs.isDir(fs.stat(path).mode);
}
