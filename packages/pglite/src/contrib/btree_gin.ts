import type {
  Extension,
  ExtensionSetupResult,
  PGliteInterface,
} from '../interface'

const setup = async (pg: PGliteInterface, emscriptenOpts: any) => {
  return {
    bundlePath: new URL('../../release/btree_gin.tar.gz', import.meta.url),
  } satisfies ExtensionSetupResult
}

export const btree_gin = {
  name: 'btree_gin',
  setup,
} satisfies Extension
