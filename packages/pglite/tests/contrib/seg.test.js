import { it, expect } from 'vitest'
import { PGlite } from '../../dist/index.js'
import { seg } from '../../dist/contrib/seg.js'

it('seg', async () => {
  const pg = new PGlite({
    extensions: {
      seg,
    },
  })

  await pg.exec('CREATE EXTENSION IF NOT EXISTS seg;')

  const ret = await pg.query(`SELECT '6.25 .. 6.50'::seg AS "pH"`)
  expect(ret.rows).toEqual([{ pH: '6.25 .. 6.50' }])

  const ret2 = await pg.query(`SELECT '7(+-)1'::seg AS "set"`)
  expect(ret2.rows).toEqual([{ set: '6 .. 8' }])
})
