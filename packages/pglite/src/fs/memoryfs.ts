import { FilesystemBase } from "./types.js";
import type { EmPostgres } from "../postgres.js";

export class MemoryFS extends FilesystemBase {
  async emscriptenOpts(opts: Partial<EmPostgres>) {
    // Nothing to do for memoryfs
    return opts;
  }
}
