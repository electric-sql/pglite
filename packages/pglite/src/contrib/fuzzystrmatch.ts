import type {
  Extension,
  ExtensionSetupResult,
  PGliteInterface,
} from '../interface'

const setup = async (pg: PGliteInterface, emscriptenOpts: any) => {
  return {
    bundlePath: new URL('../../release/fuzzystrmatch.tar.gz', import.meta.url),
  } satisfies ExtensionSetupResult
}

export const fuzzystrmatch = {
  name: 'fuzzystrmatch',
  setup,
} satisfies Extension
