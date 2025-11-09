import type {
  Extension,
  ExtensionSetupResult,
  PGliteInterface,
} from '../interface'

const setup = async (_pg: PGliteInterface, _emscriptenOpts: any) => {
  return {
    bundlePath: new URL('../../release/dict_int.tar.gz', import.meta.url),
  } satisfies ExtensionSetupResult
}

export const dict_int = {
  name: 'dict_int',
  setup,
} satisfies Extension
