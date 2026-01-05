import type {
  Extension,
  ExtensionSetupResult,
  PGliteInterface,
} from '../interface'

const setup = async (_pg: PGliteInterface, emscriptenOpts: any) => {
  return {
    emscriptenOpts,
    bundlePath: new URL('../../release/pg_session_jwt.tar.gz', import.meta.url),
  } satisfies ExtensionSetupResult
}

export const pg_session_jwt = {
  name: 'pg_session_jwt',
  setup,
} satisfies Extension
