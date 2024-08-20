import {
  assertEquals,
  assertRejects,
} from 'https://deno.land/std@0.202.0/testing/asserts.ts'
import { PGlite } from '@electric-sql/pglite'

Deno.test('filesystem new', async () => {
  const db = new PGlite('./pgdata-test')
  await db.exec(`
    CREATE TABLE IF NOT EXISTS test (
      id SERIAL PRIMARY KEY,
      name TEXT
    );
  `)

  const multiStatementResult = await db.exec(`
    INSERT INTO test (name) VALUES ('test');
    UPDATE test SET name = 'test2';
    SELECT * FROM test;
  `)

  assertEquals(multiStatementResult, [
    {
      rows: [],
      fields: [],
    },
    {
      rows: [],
      fields: [],
    },
    {
      rows: [{ id: 1, name: 'test2' }],
      fields: [
        { name: 'id', dataTypeID: 23 },
        { name: 'name', dataTypeID: 25 },
      ],
      affectedRows: 2,
    },
  ])

  await db.close()
})

Deno.test('filesystem existing', async () => {
  const db = new PGlite('./pgdata-test')

  const res = await db.exec('SELECT * FROM test;')

  assertEquals(res, [
    {
      rows: [{ id: 1, name: 'test2' }],
      fields: [
        { name: 'id', dataTypeID: 23 },
        { name: 'name', dataTypeID: 25 },
      ],
      affectedRows: 0,
    },
  ])

  await db.close()
})
