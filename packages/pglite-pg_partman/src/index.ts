import type {
  Extension,
  ExtensionSetupResult,
  PGliteInterface,
} from '@electric-sql/pglite'

const setup = async (_pg: PGliteInterface, emscriptenOpts: any) => {
  return {
    emscriptenOpts,
    bundlePath: new URL('../release/pg_partman.tar.gz', import.meta.url),
  } satisfies ExtensionSetupResult
}

export const pg_partman = {
  name: 'pg_partman',
  setup,
} satisfies Extension
