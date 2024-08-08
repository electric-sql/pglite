import type {
  Extension,
  ExtensionSetupResult,
  PGliteInterface,
} from '../interface'

const setup = async (_pg: PGliteInterface, _emscriptenOpts: any) => {
  return {
    bundlePath: new URL('../../release/seg.tar.gz', import.meta.url),
  } satisfies ExtensionSetupResult
}

export const seg = {
  name: 'seg',
  setup,
} satisfies Extension
