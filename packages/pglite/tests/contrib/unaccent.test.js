import { it, expect } from 'vitest'
import { PGlite } from '../../dist/index.js'
import { unaccent } from '../../dist/contrib/unaccent.js'

it('unaccent', async () => {
  const pg = new PGlite({
    extensions: {
      unaccent,
    },
  })

  await pg.exec('CREATE EXTENSION IF NOT EXISTS unaccent;')

  const result = await pg.query(`select ts_lexize('unaccent','Hôtel');`)

  expect(result).toEqual([
    {
      ts_lexize: ['Hotel'],
    },
  ])
})
