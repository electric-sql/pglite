import type {
  Extension,
  ExtensionSetupResult,
  PGliteInterface,
} from '@electric-sql/pglite'

const setup = async (_pg: PGliteInterface, emscriptenOpts: any) => {
  return {
    emscriptenOpts,
    bundlePath: new URL('../release/plpgsql_check.tar.gz', import.meta.url),
  } satisfies ExtensionSetupResult
}

export const plpgsql_check = {
  name: 'plpgsql_check',
  setup,
} satisfies Extension
