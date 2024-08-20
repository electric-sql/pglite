import { it, expect } from 'vitest'
import { PGlite } from '../../dist/index.js'
import { isn } from '../../dist/contrib/isn.js'

it('bloom', async () => {
  const pg = new PGlite({
    extensions: {
      isn,
    },
  })

  await pg.exec('CREATE EXTENSION IF NOT EXISTS isn;')

  const ret1 = await pg.query("SELECT isbn('978-0-393-04002-9');")
  expect(ret1.rows).toEqual([
    {
      isbn: '0-393-04002-X',
    },
  ])

  const ret2 = await pg.query("SELECT isbn13('0901690546');")
  expect(ret2.rows).toEqual([
    {
      isbn13: '978-0-901690-54-8',
    },
  ])

  const ret3 = await pg.query("SELECT issn('1436-4522');")
  expect(ret3.rows).toEqual([
    {
      issn: '1436-4522',
    },
  ])

  await pg.exec(`
    CREATE TABLE test (id isbn);
    INSERT INTO test VALUES('9780393040029');
  `)

  const ret4 = await pg.query('SELECT * FROM test;')
  expect(ret4.rows).toEqual([
    {
      id: '0-393-04002-X',
    },
  ])
})
