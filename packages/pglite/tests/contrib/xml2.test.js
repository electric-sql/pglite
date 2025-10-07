import { it, expect } from 'vitest'
import { PGlite } from '../../dist/index.js'
import { xml2 } from '../../dist/contrib/xml2.js'

it('xml2', async () => {
  const pg = new PGlite({
    extensions: {
      xml2,
    },
  })

  await pg.exec('CREATE EXTENSION IF NOT EXISTS xml2;')

})
