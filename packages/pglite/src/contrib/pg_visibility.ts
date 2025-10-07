import type {
  Extension,
  ExtensionSetupResult,
  PGliteInterface,
} from '../interface'

const setup = async (_pg: PGliteInterface, _emscriptenOpts: any) => {
  return {
    bundlePath: new URL('../../release/pg_visibility.tar.gz', import.meta.url),
  } satisfies ExtensionSetupResult
}

export const pg_visibility = {
  name: 'pg_visibility',
  setup,
} satisfies Extension
