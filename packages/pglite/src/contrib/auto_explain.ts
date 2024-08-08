import type {
  Extension,
  ExtensionSetupResult,
  PGliteInterface,
} from '../interface'

const setup = async (_pg: PGliteInterface, _emscriptenOpts: any) => {
  return {
    bundlePath: new URL('../../release/auto_explain.tar.gz', import.meta.url),
  } satisfies ExtensionSetupResult
}

export const auto_explain = {
  name: 'auto_explain',
  setup,
} satisfies Extension
