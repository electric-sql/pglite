import type {
  Extension,
  ExtensionSetupResult,
  PGliteInterface,
} from '../interface'

const setup = async (_pg: PGliteInterface, _emscriptenOpts: any) => {
  return {
    bundlePath: new URL('../../release/intarray.tar.gz', import.meta.url),
  } satisfies ExtensionSetupResult
}

export const intarray = {
  name: 'intarray',
  setup,
} satisfies Extension
