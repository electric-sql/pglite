import { it, expect } from 'vitest'
import { PGlite } from '../../dist/index.js'
import { fuzzystrmatch } from '../../dist/contrib/fuzzystrmatch.js'

it('fuzzystrmatch', async () => {
  const pg = new PGlite({
    extensions: {
      fuzzystrmatch,
    },
  })

  await pg.exec('CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;')

  const res = await pg.query(`
    SELECT
      levenshtein('kitten', 'sitting') AS distance;
  `)

  expect(res.rows).toEqual([{ distance: 3 }])

  const res2 = await pg.query(`
    SELECT
      soundex('kitten') AS soundex;
  `)

  expect(res2.rows).toEqual([{ soundex: 'K350' }])
})
