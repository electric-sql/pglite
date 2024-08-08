import type {
  Extension,
  ExtensionSetupResult,
  PGliteInterface,
} from '../interface'

const setup = async (_pg: PGliteInterface, _emscriptenOpts: any) => {
  return {
    bundlePath: new URL('../../release/ltree.tar.gz', import.meta.url),
  } satisfies ExtensionSetupResult
}

export const ltree = {
  name: 'ltree',
  setup,
} satisfies Extension
