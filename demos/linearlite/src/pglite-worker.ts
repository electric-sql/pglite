import { worker } from '@electric-sql/pglite/worker'
import { PGlite } from '@electric-sql/pglite'
import { migrate } from './migrations'

worker({
  async init() {
    const pg = await PGlite.create('idb://linearlite', {
      relaxedDurability: true,
    })
    await migrate(pg)
    return pg
  },
})
