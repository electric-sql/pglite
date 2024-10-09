import { worker } from '@electric-sql/pglite/worker'
import { PGlite } from '@electric-sql/pglite'
import { electricSync } from '@electric-sql/pglite-sync'
import { migrate } from './migrations'

worker({
  async init() {
    const pg = await PGlite.create({
      dataDir: 'idb://linearlite2',
      relaxedDurability: true,
      extensions: {
        sync: electricSync(),
      },
    })
    await migrate(pg)
    await pg.sync.syncShapeToTable({
      shape: {
        url: 'http://localhost:3000/v1/shape/issue',
      },
      table: 'issue',
      primaryKey: ['id'],
      shapeKey: 'issues',
    })
    await pg.sync.syncShapeToTable({
      shape: {
        url: 'http://localhost:3000/v1/shape/comment',
      },
      table: 'comment',
      primaryKey: ['id'],
      shapeKey: 'comments',
    })
    return pg
  },
})
