import test from 'ava'
import { PGlite } from '../dist/index.js'

test('fts basic', async (t) => {
  const db = await PGlite.create()

  let ret = await db.query(`
    SELECT 'a fat cat sat on a mat and ate a fat rat'::tsvector @@ 'cat & rat'::tsquery AS match;
  `)
  t.deepEqual(ret.rows, [{ match: true }])

  ret = await db.query(`
    SELECT to_tsvector('fat cats ate fat rats') @@ to_tsquery('fat & rat') AS match;
  `)
  t.deepEqual(ret.rows, [{ match: true }])

  ret = await db.query(`
    SELECT to_tsquery('english', 'The & Fat & Rats') as value;
  `)
  t.deepEqual(ret.rows, [{ value: "'fat' & 'rat'" }])

  ret = await db.query(`
    SELECT to_tsquery('english', 'Fat | Rats:AB') as value;
  `)
  t.deepEqual(ret.rows, [{ value: "'fat' | 'rat':AB" }])

  ret = await db.query(`
    SELECT to_tsquery('supern:*A & star:A*B') as value;
  `)
  t.deepEqual(ret.rows, [{ value: "'supern':*A & 'star':*AB" }])

  ret = await db.query(`
    SELECT plainto_tsquery('english', 'The Fat Rats') as value;
  `)
  t.deepEqual(ret.rows, [{ value: "'fat' & 'rat'" }])

  ret = await db.query(`
    SELECT plainto_tsquery('english', 'The Fat & Rats:C') as value;
  `)
  t.deepEqual(ret.rows, [{ value: "'fat' & 'rat' & 'c'" }])

  ret = await db.query(`
    SELECT phraseto_tsquery('english', 'The Fat Rats') as value;
  `)
  t.deepEqual(ret.rows, [{ value: "'fat' <-> 'rat'" }])

  ret = await db.query(`
    SELECT websearch_to_tsquery('english', '"supernovae stars" -crab') as value;
  `)
  t.deepEqual(ret.rows, [{ value: "'supernova' <-> 'star' & !'crab'" }])

  ret = await db.query(`
    SELECT websearch_to_tsquery('english', '"sad cat" or "fat rat"') as value;
  `)
  t.deepEqual(ret.rows, [{ value: "'sad' <-> 'cat' | 'fat' <-> 'rat'" }])

  ret = await db.query(`
    SELECT websearch_to_tsquery('english', 'signal -"segmentation fault"') as value;
  `)
  t.deepEqual(ret.rows, [{ value: "'signal' & !( 'segment' <-> 'fault' )" }])
})

test('fts ranking', async (t) => {
  const db = await PGlite.create()

  await db.query(`
    CREATE TABLE fts_ranking (
      id serial PRIMARY KEY,
      title text,
      body text
    );
  `)

  await db.query(`
    INSERT INTO fts_ranking (title, body)
    VALUES
      ('The Fat Rats', 'The fat rats ate the fat cats.'),
      ('The Fat Cats', 'The fat cats ate the fat rats.'),
      ('The Fat Cats and Rats', 'The fat cats and rats ate the fat rats and cats.');
  `)

  let ret = await db.query(`
    SELECT title, ts_rank_cd(to_tsvector('english', body), to_tsquery('english', 'fat & rat')) as rank
    FROM fts_ranking
    ORDER BY rank DESC;
  `)
  t.deepEqual(ret.rows, [
    {
      rank: 0.16666667,
      title: 'The Fat Cats and Rats',
    },
    {
      rank: 0.13333334,
      title: 'The Fat Rats',
    },
    {
      rank: 0.1,
      title: 'The Fat Cats',
    },
  ])

  ret = await db.query(`
    SELECT title, ts_rank_cd(to_tsvector('english', body), to_tsquery('english', 'fat | rat')) as rank
    FROM fts_ranking
    ORDER BY rank DESC;
  `)
  t.deepEqual(ret.rows, [
    {
      rank: 0.4,
      title: 'The Fat Cats and Rats',
    },
    {
      rank: 0.3,
      title: 'The Fat Rats',
    },
    {
      rank: 0.3,
      title: 'The Fat Cats',
    },
  ])

  ret = await db.query(`
    SELECT title, ts_rank_cd(to_tsvector('english', body), to_tsquery('english', 'fat & rat | cat')) as rank
    FROM fts_ranking
    ORDER BY rank DESC;
  `)
  t.deepEqual(ret.rows, [
    {
      rank: 0.33333334,
      title: 'The Fat Cats and Rats',
    },
    {
      rank: 0.23333333,
      title: 'The Fat Rats',
    },
    {
      rank: 0.2,
      title: 'The Fat Cats',
    },
  ])

  ret = await db.query(`
    SELECT title, ts_rank_cd(to_tsvector('english', body), to_tsquery('english', 'fat & rat | cat & rat')) as rank
    FROM fts_ranking
    ORDER BY rank DESC;
  `)
  t.deepEqual(ret.rows, [
    {
      rank: 0.23333333,
      title: 'The Fat Cats and Rats',
    },
    {
      rank: 0.13333334,
      title: 'The Fat Rats',
    },
    {
      rank: 0.1,
      title: 'The Fat Cats',
    },
  ])
})
