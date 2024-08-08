import type {
  Extension,
  ExtensionSetupResult,
  PGliteInterface,
} from '../interface'

const setup = async (pg: PGliteInterface, emscriptenOpts: any) => {
  return {
    bundlePath: new URL('../../release/uuid-ossp.tar.gz', import.meta.url),
  } satisfies ExtensionSetupResult
}

export const uuid_ossp = {
  name: 'uuid-ossp',
  setup,
} satisfies Extension
