import { describe, it, expect } from 'vitest'
import { PGlite } from '../dist/index.js'

describe('large objects', () => {
  it('blob', async () => {
    const pg = new PGlite()

    const text = 'hello world'
    const blob = new Blob([text], { type: 'text/plain' })

    await pg.exec(`
      CREATE TABLE test (id SERIAL PRIMARY KEY, data OID);
    `)

    await pg.query(
      `
      INSERT INTO test (data) VALUES (lo_import('/dev/blob'));
    `,
      [],
      {
        blob,
      },
    )

    const res = await pg.query(`
      SELECT lo_export(data, '/dev/blob') AS data FROM test;
    `)

    const data = res.blob
    const asText = await data.text()
    expect(asText).toBe(text)
  })
})

describe.skipIf(!process.env.PGLITE_TEST_LOTS_OF_DATA)('lots of data', () => {
  it('should allow inserting a lot of data', async () => {
    const db = await PGlite.create()
    await db.exec(
      `CREATE TABLE IF NOT EXISTS test (uuid1 TEXT, uuid2 TEXT, 
        uuid3 TEXT, uuid4 TEXT, uuid5 TEXT, uuid6 TEXT, uuid7 TEXT, uuid8 TEXT, uuid9 TEXT, uuid10 TEXT,
        uuid11 TEXT, uuid12 TEXT, uuid13 TEXT, uuid14 TEXT, uuid15 TEXT, uuid16 TEXT, uuid17 TEXT, uuid18 TEXT, uuid19 TEXT, uuid20 TEXT)`,
    );
    let i = 0;
    const uuid = '3add1088-51ce-42fb-9955-484e4d9b2716';
    while (i < 1_000_000) {
      ++i;
      if (i % 10000 === 0) console.log(`Already run ${i} times`);
      await db.query(
        `INSERT INTO test (uuid1, uuid2, uuid3, uuid4, uuid5, uuid6, uuid7, uuid8, uuid9, uuid10, 
        uuid11, uuid12, uuid13, uuid14, uuid15, uuid16, uuid17, uuid18, uuid19, uuid20) 
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`,
        [uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid],
      );
    }

    })
})