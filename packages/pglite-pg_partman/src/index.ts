import type {
  Extension,
  ExtensionSetup,
  ExtensionSetupResult,
} from '@electric-sql/pglite'

const setup: ExtensionSetup = async (_pg, emscriptenOpts) => {
  return {
    emscriptenOpts,
    bundlePath: new URL('../release/pg_partman.tar.gz', import.meta.url),
  } satisfies ExtensionSetupResult
}

export const pg_partman = {
  name: 'pg_partman',
  setup,
} satisfies Extension
