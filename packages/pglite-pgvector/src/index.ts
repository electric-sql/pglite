import { defineExtension } from '@electric-sql/pglite'

import { generatedExtensionBackend } from './generated-artifacts.js'

/** pgvector for every PGlite runtime target published by this package. */
export const vector = defineExtension({
  name: 'vector',
  version: '0.0.5',
  backend: generatedExtensionBackend,
})
