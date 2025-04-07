import { describe, it, expect } from 'vitest'
import { PGlite } from '../dist/index.js'

describe('fts', () => {
  it('basic', async () => {
    const db = await PGlite.create({ debug: false })

    let ret = await db.query(
      `SELECT 'a fat cat sat on a mat and ate a fat rat'::tsvector @@ 'cat & rat'::tsquery AS match;`,
    )
    expect(ret.rows).toEqual([{ match: true }])

    ret = await db.query(`
    SELECT to_tsvector('simple', 'fat cats ate fat rats') @@ to_tsquery('simple', 'fat & rat') AS match;
  `)
    expect(ret.rows).toEqual([{ match: false }])

    ret = await db.query(`
    SELECT to_tsquery('simple', 'The & Fat & Rats') as value;
  `)
    expect(ret.rows).toEqual([{ value: "'the' & 'fat' & 'rats'" }])

    ret = await db.query(`
    SELECT to_tsquery('simple', 'Fat | Rats:AB') as value;
  `)
    expect(ret.rows).toEqual([{ value: "'fat' | 'rats':AB" }])

    ret = await db.query(`
    SELECT to_tsquery('simple', 'supern:*A & star:A*B') as value;
  `)
    expect(ret.rows).toEqual([{ value: "'supern':*A & 'star':*AB" }])

    ret = await db.query(`
    SELECT plainto_tsquery('simple', 'The Fat Rats') as value;
  `)
    expect(ret.rows).toEqual([{ value: "'the' & 'fat' & 'rats'" }])

    ret = await db.query(`
    SELECT plainto_tsquery('simple', 'The Fat & Rats:C') as value;
  `)
    expect(ret.rows).toEqual([{ value: "'the' & 'fat' & 'rats' & 'c'" }])

    ret = await db.query(`
    SELECT phraseto_tsquery('simple', 'The Fat Rats') as value;
  `)
    expect(ret.rows).toEqual([{ value: "'the' <-> 'fat' <-> 'rats'" }])

    ret = await db.query(`
    SELECT websearch_to_tsquery('simple', '"supernovae stars" -crab') as value;
  `)
    expect(ret.rows).toEqual([{ value: "'supernovae' <-> 'stars' & !'crab'" }])

    ret = await db.query(`
    SELECT websearch_to_tsquery('simple', '"sad cat" or "fat rat"') as value;
  `)
    expect(ret.rows).toEqual([{ value: "'sad' <-> 'cat' | 'fat' <-> 'rat'" }])

    ret = await db.query(`
    SELECT websearch_to_tsquery('simple', 'signal -"segmentation fault"') as value;
  `)
    expect(ret.rows).toEqual([
      { value: "'signal' & !( 'segmentation' <-> 'fault' )" },
    ])
  })

  it('ranking', async () => {
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
    SELECT title, ts_rank_cd(to_tsvector('simple', body), to_tsquery('simple', 'fat & rat')) as rank
    FROM fts_ranking
    ORDER BY rank DESC;
  `)
    expect(ret.rows).toEqual([
      {
        rank: 0,
        title: 'The Fat Rats',
      },
      {
        rank: 0,
        title: 'The Fat Cats',
      },
      {
        rank: 0,
        title: 'The Fat Cats and Rats',
      },
    ])

    ret = await db.query(`
    SELECT title, ts_rank_cd(to_tsvector('simple', body), to_tsquery('simple', 'fat | rat')) as rank
    FROM fts_ranking
    ORDER BY rank DESC;
  `)
    expect(ret.rows).toEqual([
      {
        rank: 0.2,
        title: 'The Fat Rats',
      },
      {
        rank: 0.2,
        title: 'The Fat Cats',
      },
      {
        rank: 0.2,
        title: 'The Fat Cats and Rats',
      },
    ])

    ret = await db.query(`
    SELECT title, ts_rank_cd(to_tsvector('simple', body), to_tsquery('simple', 'fat & rat | cat')) as rank
    FROM fts_ranking
    ORDER BY rank DESC;
  `)
    expect(ret.rows).toEqual([
      {
        rank: 0,
        title: 'The Fat Rats',
      },
      {
        rank: 0,
        title: 'The Fat Cats',
      },
      {
        rank: 0,
        title: 'The Fat Cats and Rats',
      },
    ])

    ret = await db.query(`
    SELECT title, ts_rank_cd(to_tsvector('simple', body), to_tsquery('simple', 'fat & rat | cat & rat')) as rank
    FROM fts_ranking
    ORDER BY rank DESC;
  `)
    expect(ret.rows).toEqual([
      {
        rank: 0,
        title: 'The Fat Rats',
      },
      {
        rank: 0,
        title: 'The Fat Cats',
      },
      {
        rank: 0,
        title: 'The Fat Cats and Rats',
      },
    ])
  })
})
