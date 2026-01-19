import type {
  Extension,
  ExtensionSetupResult,
  PGliteInterface,
} from '../interface'

const setup = async (_pg: PGliteInterface, emscriptenOpts: any) => {
  return {
    emscriptenOpts,
    bundlePath: new URL('../../release/pg_textsearch.tar.gz', import.meta.url),
  } satisfies ExtensionSetupResult
}

export const pg_textsearch = {
  name: 'pg_textsearch',
  setup,
} satisfies Extension
