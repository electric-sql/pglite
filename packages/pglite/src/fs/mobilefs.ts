import * as FileSystem from 'expo-file-system';
import { FilesystemBase } from './types.js';
import type { PostgresMod, FS } from '../postgresMod.js';
import { dumpTar } from './tarUtils.js';

export class MobileFS extends FilesystemBase {
  async emscriptenOpts(opts: Partial<PostgresMod>) {
    const options: Partial<PostgresMod> = {
      ...opts,
      preRun: [
        ...(opts.preRun || []),
        (mod: any) => {
          mod.FS.mkdir('/mobilefs');
          mod.FS.mount(mod.FS.filesystems.NODEFS, { root: this.dataDir }, '/mobilefs');
        },
      ],
    };
    return options;
  }

  async dumpTar(mod: FS, dbname: string) {
    return dumpTar(mod, dbname);
  }

  async close(FS: FS): Promise<void> {
    FS.quit();
  }

  async readFile(path: string): Promise<string> {
    return await FileSystem.readAsStringAsync(path);
  }

  async writeFile(path: string, contents: string): Promise<void> {
    await FileSystem.writeAsStringAsync(path, contents);
  }

  async deleteFile(path: string): Promise<void> {
    await FileSystem.deleteAsync(path);
  }
}
