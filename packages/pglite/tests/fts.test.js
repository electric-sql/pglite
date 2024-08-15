import test from 'ava'
import { PGlite } from '../dist/index.js'

test.serial('fts basic', async (t) => {
  const db = await PGlite.create()

  const ret1 = await db.query(`
    SELECT 'a fat cat sat on a mat and ate a fat rat'::tsvector @@ 'cat & rat'::tsquery AS match;
  `)

  t.deepEqual(ret1.rows, [{ match: true }])

  const ret2 = await db.query(`
    SELECT to_tsvector('fat cats ate fat rats') @@ to_tsquery('fat & rat') AS match;
  `)

  t.deepEqual(ret2.rows, [{ match: true }])
})
