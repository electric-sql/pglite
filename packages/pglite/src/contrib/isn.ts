import type {
  Extension,
  ExtensionSetupResult,
  PGliteInterface,
} from '../interface'

const setup = async (pg: PGliteInterface, emscriptenOpts: any) => {
  return {
    bundlePath: new URL('../../release/isn.tar.gz', import.meta.url),
  } satisfies ExtensionSetupResult
}

export const isn = {
  name: 'isn',
  setup,
} satisfies Extension
