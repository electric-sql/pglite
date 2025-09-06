// RN entrypoint exports the same API as @electric-sql/pglite-base,
// but uses a native-backed adapter under the hood for execProtocol.

// Re-export core pglite-base functionality (excluding Node-specific modules)
export { BasePGlite } from '@electric-sql/pglite-base'
export * from '@electric-sql/pglite-base/interface.js'
export * from '@electric-sql/pglite-base/types.js'
export * from '@electric-sql/pglite-base/parse.js'
export * from '@electric-sql/pglite-base/errors.js'
export * from '@electric-sql/pglite-base/templating.js'
export * from '@electric-sql/pglite-base/postgresMod.js'
export * from '@electric-sql/pglite-base/utils.js'
// Note: Excluding MemoryFS, fs/base.js, extensionUtils.js and fs/tarUtils.js as they contain Node.js-specific code
// React Native uses native filesystem layer instead of WebAssembly filesystem utilities
export { vector } from '@electric-sql/pglite-base/vector/index.js'
export { pg_ivm } from '@electric-sql/pglite-base/pg_ivm/index.js'
// Contrib extensions (React Native compatible)
export { amcheck } from '@electric-sql/pglite-base/contrib/amcheck.js'
export { auto_explain } from '@electric-sql/pglite-base/contrib/auto_explain.js'
export { bloom } from '@electric-sql/pglite-base/contrib/bloom.js'
export { btree_gin } from '@electric-sql/pglite-base/contrib/btree_gin.js'
export { btree_gist } from '@electric-sql/pglite-base/contrib/btree_gist.js'
export { citext } from '@electric-sql/pglite-base/contrib/citext.js'
export { cube } from '@electric-sql/pglite-base/contrib/cube.js'
export { earthdistance } from '@electric-sql/pglite-base/contrib/earthdistance.js'
export { fuzzystrmatch } from '@electric-sql/pglite-base/contrib/fuzzystrmatch.js'
export { hstore } from '@electric-sql/pglite-base/contrib/hstore.js'
export { isn } from '@electric-sql/pglite-base/contrib/isn.js'
export { lo } from '@electric-sql/pglite-base/contrib/lo.js'
export { ltree } from '@electric-sql/pglite-base/contrib/ltree.js'
export { pg_trgm } from '@electric-sql/pglite-base/contrib/pg_trgm.js'
export { seg } from '@electric-sql/pglite-base/contrib/seg.js'
export { tablefunc } from '@electric-sql/pglite-base/contrib/tablefunc.js'
export { tcn } from '@electric-sql/pglite-base/contrib/tcn.js'
export { tsm_system_rows } from '@electric-sql/pglite-base/contrib/tsm_system_rows.js'
export { tsm_system_time } from '@electric-sql/pglite-base/contrib/tsm_system_time.js'
export { uuid_ossp } from '@electric-sql/pglite-base/contrib/uuid_ossp.js'

// Export additional dependencies that might be needed
export * as messages from '@electric-sql/pg-protocol/messages'
export * as protocol from '@electric-sql/pg-protocol'
export { Mutex } from 'async-mutex'

// Export the React Native PGlite implementation as the main PGlite class
export { PGliteReactNative as PGlite } from './adapter'

// Export native bridge utilities for advanced use cases
export { getPGLiteNative } from './nativeBridge'
