import { it, expect } from 'vitest'
import { PGlite } from '../../dist/index.js'
import { dict_xsyn } from '../../dist/contrib/dict_xsyn.js'

it('dict_xsyn', async () => {
  const pg = await PGlite.create({
    extensions: {
      dict_xsyn,
    },
  })

  // from dict_xsyn.sql
  await pg.exec('CREATE EXTENSION IF NOT EXISTS dict_xsyn;')
  await pg.exec(`
-- default configuration - match first word and return it among with all synonyms
ALTER TEXT SEARCH DICTIONARY xsyn (RULES='xsyn_sample', KEEPORIG=true, MATCHORIG=true, KEEPSYNONYMS=true, MATCHSYNONYMS=false);
`)

  const lexizeResult1 = await pg.query(`
SELECT ts_lexize('xsyn', 'supernova');
`)

  expect(lexizeResult1.rows[0]).toEqual({
    ts_lexize: ['supernova', 'sn', 'sne', '1987a'],
  })

  const lexizeResult2 = await pg.query(`
SELECT ts_lexize('xsyn', 'sn');
`)

  expect(lexizeResult2.rows[0]).toEqual({
    ts_lexize: null,
  })

  const lexizeResult3 = await pg.query(`
SELECT ts_lexize('xsyn', 'grb');
`)

  expect(lexizeResult3.rows[0]).toEqual({
    ts_lexize: null,
  })
})
