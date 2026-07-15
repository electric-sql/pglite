import { defineExtension } from '@electric-sql/pglite'

import { generatedExtensionBackend } from './generated-artifacts.js'

/** PostGIS for every PGlite runtime target published by this package. */
export const postgis = defineExtension({
  name: 'postgis',
  version: '0.2.4',
  backend: generatedExtensionBackend,
})
