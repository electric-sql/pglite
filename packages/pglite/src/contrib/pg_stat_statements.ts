import type {
  Extension,
  ExtensionSetupResult,
  PGliteInterface,
} from '../interface'

const setup = async (_pg: PGliteInterface, _emscriptenOpts: any) => {
  return {
    bundlePath: new URL(
      '../../release/pg_stat_statements.tar.gz',
      import.meta.url,
    ),
    sharedPreloadLibraries: ['pg_stat_statements'],
  } satisfies ExtensionSetupResult
}

export const pg_stat_statements = {
  name: 'pg_stat_statements',
  setup,
} satisfies Extension
