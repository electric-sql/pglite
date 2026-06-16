import type {
  Extension,
  ExtensionSetupResult,
  PGliteInterface,
} from '../interface'

const setup = async (_pg: PGliteInterface, _emscriptenOpts: any) => {
  return {
    bundlePath: new URL('../../release/postgres_fdw.tar.gz', import.meta.url),
  } satisfies ExtensionSetupResult
}

export const postgres_fdw = {
  name: 'postgres_fdw',
  setup,
} satisfies Extension
