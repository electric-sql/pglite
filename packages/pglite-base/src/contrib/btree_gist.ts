import type {
  Extension,
  ExtensionSetupResult,
  PGliteInterface,
} from '../interface'

const setup = async (_pg: PGliteInterface, _emscriptenOpts: any) => {
  return {
    bundlePath: new URL('../../release/btree_gist.tar.gz', import.meta.url),
  } satisfies ExtensionSetupResult
}

export const btree_gist = {
  name: 'btree_gist',
  setup,
} satisfies Extension
