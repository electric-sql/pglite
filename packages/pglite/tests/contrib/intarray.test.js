import { it, expect } from 'vitest'
import { PGlite } from '../../dist/index.js'
import { intarray } from '../../dist/contrib/intarray.js'

it('intarray', async () => {
  const pg = await PGlite.create({
    extensions: {
      intarray,
    },
  })

  await pg.exec('CREATE EXTENSION IF NOT EXISTS intarray;')

  await pg.exec(`
    CREATE TABLE articles (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      tag_ids INTEGER[]);`)

  await pg.exec(`
    INSERT INTO articles (title, tag_ids) VALUES
    ('Postgres Performance Tips', '{1,2,3}'),
    ('Introduction to SQL', '{2,4}'),
    ('Advanced intarray Usage', '{1,3,5}'),
    ('Database Normalization', '{4,6}');`)

  const titleTags25 = await pg.query(`
    SELECT title, tag_ids
    FROM articles
    WHERE tag_ids && '{2,5}'::integer[];`)

  expect(titleTags25.rows).toEqual([
    {
      title: 'Postgres Performance Tips',
      tag_ids: [1, 2, 3],
    },
    {
      title: 'Introduction to SQL',
      tag_ids: [2, 4],
    },
    {
      title: 'Advanced intarray Usage',
      tag_ids: [1, 3, 5],
    },
  ])

  const titleTags12 = await pg.query(`
    SELECT title, tag_ids
    FROM articles
    WHERE tag_ids @> '{1,2}'::integer[];`)

  expect(titleTags12.rows).toEqual([
    {
      title: 'Postgres Performance Tips',
      tag_ids: [1, 2, 3],
    },
  ])

  const titleTags1235 = await pg.query(`
    SELECT title, tag_ids
    FROM articles
    WHERE tag_ids <@ '{1,2,3,5}'::integer[];`)

  expect(titleTags1235.rows).toEqual([
    {
      title: 'Postgres Performance Tips',
      tag_ids: [1, 2, 3],
    },
    {
      title: 'Advanced intarray Usage',
      tag_ids: [1, 3, 5],
    },
  ])

  const queryInt = await pg.query(`
    SELECT title, tag_ids
    FROM articles
    WHERE tag_ids @@ '1 & (3|4)'::query_int;`)

  expect(queryInt.rows).toEqual([
    {
      title: 'Postgres Performance Tips',
      tag_ids: [1, 2, 3],
    },
    {
      title: 'Advanced intarray Usage',
      tag_ids: [1, 3, 5],
    },
  ])
})
