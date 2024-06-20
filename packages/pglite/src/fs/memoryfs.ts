import { FilesystemBase } from "./types.js";
import type { EmPostgres } from "../../release/postgres.js";

export class MemoryFS extends FilesystemBase {
  constructor(dataDir?: string) {
    super(dataDir);
    this.dataDir = 'base';
  }

  async emscriptenOpts(opts: Partial<EmPostgres>) {
    return opts;
  }
}
