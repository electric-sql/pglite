import type {
  Extension,
  ExtensionSetupResult,
  PGliteInterface,
} from '../interface'

const setup = async (_pg: PGliteInterface, emscriptenOpts: any) => {
  return {
    emscriptenOpts,
    bundlePath: new URL('../../release/age.tar.gz', import.meta.url),
  } satisfies ExtensionSetupResult
}

export const age = {
  name: 'age',
  setup,
} satisfies Extension
