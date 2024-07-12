import { FilesystemBase } from "./types.js";
import type { PostgresMod } from "../postgres.js";

export class MemoryFS extends FilesystemBase {
  async emscriptenOpts(opts: Partial<PostgresMod>) {
    // Nothing to do for memoryfs
    return opts;
  }
}
