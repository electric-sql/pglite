import { it } from 'vitest'
import { PGlite } from '../../dist/index.js'
import { pg_surgery } from '../../dist/contrib/pg_surgery.js'

it('pg_surgery', async () => {
  const pg = await PGlite.create({
    extensions: {
      pg_surgery,
    },
  })

  await pg.exec('CREATE EXTENSION IF NOT EXISTS pg_surgery;')

  // unsure how to test this extension
})
