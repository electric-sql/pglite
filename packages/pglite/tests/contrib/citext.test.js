import test from 'ava'
import { PGlite } from '../../dist/index.js'
import { citext } from '../../dist/contrib/citext.js'

test('citext', async (t) => {
  const pg = new PGlite({
    extensions: {
      citext,
    },
  })

  await pg.exec('CREATE EXTENSION IF NOT EXISTS citext;')

  await pg.exec(`
    CREATE TABLE IF NOT EXISTS test (
      id SERIAL PRIMARY KEY,
      name CITEXT
    );
  `)

  await pg.exec("INSERT INTO test (name) VALUES ('tEsT1');")
  await pg.exec("INSERT INTO test (name) VALUES ('TeSt2');")
  await pg.exec("INSERT INTO test (name) VALUES ('TEST3');")

  const res = await pg.query(`
    SELECT
      name
    FROM test
    WHERE name = 'test1';
  `)

  t.deepEqual(res.rows, [
    {
      name: 'tEsT1',
    },
  ])
})
