import { it } from 'vitest'
import { PGlite } from '../../dist/index.js'
import { pgcrypto } from '../../dist/contrib/pgcrypto.js'

it('pgcrypto', async () => {
  const pg = await PGlite.create({
    extensions: {
      pgcrypto,
    },
  })

  await pg.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto;')

  const result = await pg.exec(`SELECT crypt('mypass', gen_salt('bf', 4));`)

  // needs some thorough testing
  console.log(result)
})
