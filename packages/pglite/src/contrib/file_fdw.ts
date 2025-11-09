import type {
  Extension,
  ExtensionSetupResult,
  PGliteInterface,
} from '../interface'

const setup = async (_pg: PGliteInterface, _emscriptenOpts: any) => {
  return {
    bundlePath: new URL('../../release/file_fdw.tar.gz', import.meta.url),
  } satisfies ExtensionSetupResult
}

export const file_fdw = {
  name: 'file_fdw',
  setup,
} satisfies Extension
