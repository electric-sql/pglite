import { describe, it, expect } from 'vitest'
import { PGlite } from '../dist/index.js'

describe('fts', () => {
  it('basic', async () => {
    const db = await PGlite.create({"debug":true})

    let ret = await db.query(`
    SELECT 'a fat cat sat on a mat and ate a fat rat'::tsvector @@ 'cat & rat'::tsquery AS match;
  `)
    expect(ret.rows).toEqual([{ match: true }])

    ret = await db.query(`
    SELECT to_tsvector('english', 'fat cats ate fat rats') @@ to_tsquery('english', 'fat & rat') AS match;
  `)
    expect(ret.rows).toEqual([{ match: true }])

    ret = await db.query(`
    SELECT to_tsquery('english', 'The & Fat & Rats') as value;
  `)
    expect(ret.rows).toEqual([{ value: "'fat' & 'rat'" }])

    ret = await db.query(`
    SELECT to_tsquery('english', 'Fat | Rats:AB') as value;
  `)
    expect(ret.rows).toEqual([{ value: "'fat' | 'rat':AB" }])

    ret = await db.query(`
    SELECT to_tsquery('english', 'supern:*A & star:A*B') as value;
  `)
    expect(ret.rows).toEqual([{ value: "'supern':*A & 'star':*AB" }])

    ret = await db.query(`
    SELECT plainto_tsquery('english', 'The Fat Rats') as value;
  `)
    expect(ret.rows).toEqual([{ value: "'fat' & 'rat'" }])

    ret = await db.query(`
    SELECT plainto_tsquery('english', 'The Fat & Rats:C') as value;
  `)
    expect(ret.rows).toEqual([{ value: "'fat' & 'rat' & 'c'" }])

    ret = await db.query(`
    SELECT phraseto_tsquery('english', 'The Fat Rats') as value;
  `)
    expect(ret.rows).toEqual([{ value: "'fat' <-> 'rat'" }])

    ret = await db.query(`
    SELECT websearch_to_tsquery('english', '"supernovae stars" -crab') as value;
  `)
    expect(ret.rows).toEqual([{ value: "'supernova' <-> 'star' & !'crab'" }])

    ret = await db.query(`
    SELECT websearch_to_tsquery('english', '"sad cat" or "fat rat"') as value;
  `)
    expect(ret.rows).toEqual([{ value: "'sad' <-> 'cat' | 'fat' <-> 'rat'" }])

    ret = await db.query(`
    SELECT websearch_to_tsquery('english', 'signal -"segmentation fault"') as value;
  `)
    expect(ret.rows).toEqual([
      { value: "'signal' & !( 'segment' <-> 'fault' )" },
    ])
  })

  it('ranking', async () => {
    const db = await PGlite.create({"debug":true})

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
    expect(ret.rows).toEqual([
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
    expect(ret.rows).toEqual([
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
    expect(ret.rows).toEqual([
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
    expect(ret.rows).toEqual([
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
})
