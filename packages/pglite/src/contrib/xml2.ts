import type {
  Extension,
  ExtensionSetupResult,
  PGliteInterface,
} from '../interface'

const setup = async (_pg: PGliteInterface, _emscriptenOpts: any) => {
  return {
    bundlePath: new URL('../../release/pgxml.tar.gz', import.meta.url),
  } satisfies ExtensionSetupResult
}

export const xml2 = {
  name: 'xml2',
  setup,
} satisfies Extension
