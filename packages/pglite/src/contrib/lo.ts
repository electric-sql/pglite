import type {
  Extension,
  ExtensionSetupResult,
  PGliteInterface,
} from '../interface'

const setup = async (_pg: PGliteInterface, _emscriptenOpts: any) => {
  return {
    bundlePath: new URL('../../release/lo.tar.gz', import.meta.url),
  } satisfies ExtensionSetupResult
}

export const lo = {
  name: 'lo',
  setup,
} satisfies Extension
