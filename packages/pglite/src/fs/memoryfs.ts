import { FilesystemBase } from "./types.js";
import type { PostgresMod, FS } from "../postgres.js";
import { dumpTar } from "./tarUtils.js";

export class MemoryFS extends FilesystemBase {
  async emscriptenOpts(opts: Partial<PostgresMod>) {
    // Nothing to do for memoryfs
    return opts;
  }

  async dumpTar(mod: FS) {
    return dumpTar(mod);
  }
}
