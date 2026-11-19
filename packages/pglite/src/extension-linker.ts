import type { PostgresMod } from './postgresMod.js'

const RTLD_NOW = 2
const RTLD_GLOBAL = 256

export function linkExtensionProvider(
  mod: Pick<
    PostgresMod,
    'stringToNewUTF8' | '_dlopen' | '_dlerror' | 'UTF8ToString' | '_free'
  >,
  filePath: string,
): void {
  const pathPointer = mod.stringToNewUTF8(filePath)
  try {
    if (mod._dlopen(pathPointer, RTLD_NOW | RTLD_GLOBAL) === 0) {
      throw new Error(
        `Could not link extension provider ${filePath}: ${mod.UTF8ToString(mod._dlerror())}`,
      )
    }
  } finally {
    mod._free(pathPointer)
  }
}
