import type {
  Extension,
  ExtensionSetupResult,
  PGliteInterface,
} from '@electric-sql/pglite'

import { pglUtils } from '@electric-sql/pglite-utils'

const setup = async (_pg: PGliteInterface, emscriptenOpts: any) => {
  emscriptenOpts.PGLITE_ENV.POSTGIS_GDAL_ENABLED_DRIVERS = 'ENABLE_ALL'
  emscriptenOpts.PGLITE_ENV.POSTGIS_ENABLE_OUTDB_RASTERS = 1
  emscriptenOpts.PGLITE_ENV.PROJ_DATA = `${pglUtils.WASM_PREFIX}/share/proj`

  return {
    emscriptenOpts,
    bundlePath: new URL('../release/postgis.tar.gz', import.meta.url),
  } satisfies ExtensionSetupResult
}

export const postgis = {
  name: 'postgis',
  setup,
} satisfies Extension
