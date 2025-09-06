import type {
  Extension,
  ExtensionSetupResult,
  PGliteInterface,
} from '../interface'

const setup = async (_pg: PGliteInterface, emscriptenOpts: any) => {
  return {
    emscriptenOpts,
    bundlePath: new URL('../../release/pg_ivm.tar.gz', import.meta.url),
  } satisfies ExtensionSetupResult
}

export const pg_ivm = {
  name: 'pg_ivm',
  setup,
} satisfies Extension
