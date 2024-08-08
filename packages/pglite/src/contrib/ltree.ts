import type {
  Extension,
  ExtensionSetupResult,
  PGliteInterface,
} from '../interface'

const setup = async (pg: PGliteInterface, emscriptenOpts: any) => {
  return {
    bundlePath: new URL('../../release/ltree.tar.gz', import.meta.url),
  } satisfies ExtensionSetupResult
}

export const ltree = {
  name: 'ltree',
  setup,
} satisfies Extension
