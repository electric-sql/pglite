import type {
  Extension,
  ExtensionSetupResult,
  PGliteInterface,
} from '../interface'

const setup = async (_pg: PGliteInterface, _emscriptenOpts: any) => {
  return {
    bundlePath: new URL('../../release/pg_trgm.tar.gz', import.meta.url),
  } satisfies ExtensionSetupResult
}

export const pg_trgm = {
  name: 'pg_trgm',
  setup,
} satisfies Extension
