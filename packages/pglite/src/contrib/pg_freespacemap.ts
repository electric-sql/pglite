import type {
  Extension,
  ExtensionSetupResult,
  PGliteInterface,
} from '../interface'

const setup = async (_pg: PGliteInterface, _emscriptenOpts: any) => {
  return {
    bundlePath: new URL(
      '../../release/pg_freespacemap.tar.gz',
      import.meta.url,
    ),
  } satisfies ExtensionSetupResult
}

export const pg_freespacemap = {
  name: 'pg_freespacemap',
  setup,
} satisfies Extension
