import type {
  Extension,
  ExtensionSetupResult,
  PGliteInterface,
} from '../interface'

const setup = async (pg: PGliteInterface, emscriptenOpts: any) => {
  return {
    bundlePath: new URL('../../release/earthdistance.tar.gz', import.meta.url),
  } satisfies ExtensionSetupResult
}

export const earthdistance = {
  name: 'earthdistance',
  setup,
} satisfies Extension
