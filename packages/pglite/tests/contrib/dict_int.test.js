import { it, expect } from 'vitest'
import { PGlite } from '../../dist/index.js'
import { dict_int } from '../../dist/contrib/dict_int.js'

it('dict_int', async () => {
  const pg = await PGlite.create({
    extensions: {
      dict_int,
    },
  })

  // from dict_int.sql
  await pg.exec('CREATE EXTENSION IF NOT EXISTS dict_int;')

  const lexizeResult1 = await pg.query(`
select ts_lexize('intdict', '511673');
`)

  expect(lexizeResult1.rows[0]).toEqual({
    ts_lexize: ['511673'],
  })

  const lexizeResult2 = await pg.query(`
select ts_lexize('intdict', '129');
`)

  expect(lexizeResult2.rows[0]).toEqual({
    ts_lexize: ['129'],
  })

  const lexizeResult3 = await pg.query(`
select ts_lexize('intdict', '40865854');
`)

  expect(lexizeResult3.rows[0]).toEqual({
    ts_lexize: ['408658'],
  })
})
