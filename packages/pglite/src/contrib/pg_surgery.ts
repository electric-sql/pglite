import type {
  Extension,
  ExtensionSetupResult,
  PGliteInterface,
} from '../interface'

const setup = async (_pg: PGliteInterface, _emscriptenOpts: any) => {
  return {
    bundlePath: new URL('../../release/pg_surgery.tar.gz', import.meta.url),
  } satisfies ExtensionSetupResult
}

export const pg_surgery = {
  name: 'pg_surgery',
  setup,
} satisfies Extension
