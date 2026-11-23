import type {
  Extension,
  ExtensionSetupResult,
  PGliteInterface,
} from '@electric-sql/pglite'

const setup = async (_pg: PGliteInterface, emscriptenOpts: any) => {
  return {
    emscriptenOpts,
    bundlePath: new URL('../release/hypopg.tar.gz', import.meta.url),
    sharedPreloadLibraries: ['hypopg'],
  } satisfies ExtensionSetupResult
}

export const hypopg = {
  name: 'hypopg',
  setup,
} satisfies Extension
