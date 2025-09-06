// Re-export from pglite-base
export * from '@electric-sql/pglite-base'

// Export web-specific implementations
export * from './pglite.js'
export { IdbFs } from './fs/idbfs.js'

// Export additional dependencies
export * as messages from '@electric-sql/pg-protocol/messages'
export * as protocol from '@electric-sql/pg-protocol'
export { Mutex } from 'async-mutex'

// Export PostgresMod types and factory
export * as postgresMod from './postgresMod.js'
