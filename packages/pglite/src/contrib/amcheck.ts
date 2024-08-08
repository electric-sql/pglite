import type {
  Extension,
  ExtensionSetupResult,
  PGliteInterface,
} from '../interface'

const setup = async (pg: PGliteInterface, emscriptenOpts: any) => {
  return {
    bundlePath: new URL('../../release/amcheck.tar.gz', import.meta.url),
  } satisfies ExtensionSetupResult
}

export const amcheck = {
  name: 'amcheck',
  setup,
} satisfies Extension
