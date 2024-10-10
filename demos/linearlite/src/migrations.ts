import type { PGlite } from '@electric-sql/pglite'
import m1 from '../db/migrations-client/01-create_tables.sql?raw'

export async function migrate(pg: PGlite) {
  await pg.exec(m1)
}
