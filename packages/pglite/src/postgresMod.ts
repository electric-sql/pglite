import PostgresModFactory from '../release/pglite'

// Re-export types from pglite-base
export type { FS, PostgresMod, PostgresFactory } from '@electric-sql/pglite-base'

// Export the factory implementation
export default PostgresModFactory