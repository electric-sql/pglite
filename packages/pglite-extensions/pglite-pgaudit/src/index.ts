import type {
  Extension,
  ExtensionSetupResult,
  PGliteInterface,
} from '@electric-sql/pglite'

const setup = async (_pg: PGliteInterface, emscriptenOpts: any) => {
  return {
    emscriptenOpts,
    bundlePath: new URL('../release/pgaudit.tar.gz', import.meta.url),
    sharedPreloadLibraries: ['pgaudit'],
  } satisfies ExtensionSetupResult
}

export const pgaudit = {
  name: 'pgaudit',
  setup,
} satisfies Extension
