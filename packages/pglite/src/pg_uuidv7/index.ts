import type {
  Extension,
  ExtensionSetupResult,
  PGliteInterface,
} from '../interface'

const setup = async (_pg: PGliteInterface, emscriptenOpts: any) => {
  return {
    emscriptenOpts,
    bundlePath: new URL('../../release/pg_uuidv7.tar.gz', import.meta.url),
  } satisfies ExtensionSetupResult
}

export const pg_uuidv7 = {
  name: 'pg_uuidv7',
  setup,
} satisfies Extension