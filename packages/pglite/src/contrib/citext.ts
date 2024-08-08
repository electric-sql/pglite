import type {
  Extension,
  ExtensionSetupResult,
  PGliteInterface,
} from '../interface'

const setup = async (pg: PGliteInterface, emscriptenOpts: any) => {
  return {
    bundlePath: new URL('../../release/citext.tar.gz', import.meta.url),
  } satisfies ExtensionSetupResult
}

export const citext = {
  name: 'citext',
  setup,
} satisfies Extension
