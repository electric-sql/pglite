import type {
  Extension,
  ExtensionSetupResult,
  PGliteInterface,
} from '../interface'

const setup = async (_pg: PGliteInterface, _emscriptenOpts: any) => {
  return {
    bundlePath: new URL('../../release/pageinspect.tar.gz', import.meta.url),
  } satisfies ExtensionSetupResult
}

export const pageinspect = {
  name: 'pageinspect',
  setup,
} satisfies Extension
