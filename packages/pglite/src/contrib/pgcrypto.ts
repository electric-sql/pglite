import type {
  Extension,
  ExtensionSetupResult,
  PGliteInterface,
} from '../interface'

const setup = async (_pg: PGliteInterface, _emscriptenOpts: any) => {
  return {
    bundlePath: new URL('../../release/pgcrypto.tar.gz', import.meta.url),
  } satisfies ExtensionSetupResult
}

export const pgcrypto = {
  name: 'pgcrypto',
  setup,
} satisfies Extension