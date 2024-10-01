import { EmscriptenBuiltinFilesystem } from './base.js'
import type { PostgresMod, FS } from '../postgresMod.js'

export class MemoryFS extends EmscriptenBuiltinFilesystem {
  async emscriptenOpts(opts: Partial<PostgresMod>) {
    // Nothing to do for memoryfs
    return opts
  }

  async closeFs(FS: FS): Promise<void> {
    FS.quit()
  }
}
