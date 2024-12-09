import { worker } from '@electric-sql/pglite/worker'
import { PGlite } from '@electric-sql/pglite'
import { migrate } from './migrations'

worker({
  async init() {
    const pg = await PGlite.create({
      dataDir: 'idb://linearlite2',
      relaxedDurability: true,
    })
    // Migrate the database to the latest schema
    await migrate(pg)
    return pg
  },
})
