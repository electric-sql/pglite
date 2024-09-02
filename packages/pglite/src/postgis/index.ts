import type {
  Extension,
  ExtensionSetupResult,
  PGliteInterface,
} from '../interface'

const setup = async (_pg: PGliteInterface, emscriptenOpts: any) => {
  return {
    emscriptenOpts,
    bundlePath: new URL('../../release/postgis.tar.gz', import.meta.url),
  } satisfies ExtensionSetupResult
}

export const vector = {
  name: 'postgis',
  setup,
} satisfies Extension
