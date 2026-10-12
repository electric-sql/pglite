import type {
  Extension,
  ExtensionSetupResult,
  PGliteInterface,
} from '@electric-sql/pglite'

const setup = async (_pg: PGliteInterface, emscriptenOpts: any) => {
  return {
    emscriptenOpts,
    bundlePath: new URL('../release/pg_repack.tar.gz', import.meta.url),
    sharedPreloadLibraries: ['pg_repack'],
  } satisfies ExtensionSetupResult
}

export const pg_repack = {
  name: 'pg_repack',
  setup,
} satisfies Extension
