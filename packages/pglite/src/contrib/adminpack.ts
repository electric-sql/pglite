import type {
  Extension,
  ExtensionSetupResult,
  PGliteInterface,
} from '../interface'

const setup = async (_pg: PGliteInterface, _emscriptenOpts: any) => {
  return {
    bundlePath: new URL('../../release/adminpack.tar.gz', import.meta.url),
  } satisfies ExtensionSetupResult
}

export const adminpack = {
  name: 'adminpack',
  setup,
} satisfies Extension
