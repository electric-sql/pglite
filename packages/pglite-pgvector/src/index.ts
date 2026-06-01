import type {
  Extension,
  ExtensionSetupResult,
  PGliteInterface,
} from '@electric-sql/pglite'

const setup = async (_pg: PGliteInterface, emscriptenOpts: any) => {
  return {
    emscriptenOpts,
    bundlePath: new URL('../release/vector.tar.gz', import.meta.url),
  } satisfies ExtensionSetupResult
}

export const vector = {
  name: 'vector',
  setup,
} satisfies Extension
