import type {
  Extension,
  ExtensionSetupResult,
  PGliteInterface,
} from '../interface'

const setup = async (_pg: PGliteInterface, _emscriptenOpts: any) => {
  return {
    bundlePath: new URL('../../release/spi.tar.gz', import.meta.url),
  } satisfies ExtensionSetupResult
}

export const moddatetime = {
  name: 'moddatetime',
  setup,
} satisfies Extension
