import { describe, it, expect } from 'vitest'
import { expectToThrowAsync } from './polytest-vitest.js'

await tests('esm')
await tests('cjs')

async function tests(importType) {
  const { PGlite } =
    importType === 'esm'
      ? await import('../dist/index.js')
      : await import('../dist/index.cjs')

  describe(`basic ${importType}`, () => {
    it('exec', async () => {
      const db = new PGlite()
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

      expect(multiStatementResult).toEqual([
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
    })

    it('query', async () => {
      const db = new PGlite()
      await db.query(`
    CREATE TABLE IF NOT EXISTS test (
      id SERIAL PRIMARY KEY,
      name TEXT
    );
  `)
      await db.query("INSERT INTO test (name) VALUES ('test');")
      const selectResult = await db.query(`
    SELECT * FROM test;
  `)

      expect(selectResult).toEqual({
        rows: [
          {
            id: 1,
            name: 'test',
          },
        ],
        fields: [
          {
            name: 'id',
            dataTypeID: 23,
          },
          {
            name: 'name',
            dataTypeID: 25,
          },
        ],
        affectedRows: 0,
      })

      const updateResult = await db.query("UPDATE test SET name = 'test2';")
      expect(updateResult).toEqual({
        rows: [],
        fields: [],
        affectedRows: 1,
      })
    })

    it('types', async () => {
      const db = new PGlite()
      await db.query(`
    CREATE TABLE IF NOT EXISTS test (
      id SERIAL PRIMARY KEY,
      text TEXT,
      number INT,
      float FLOAT,
      bigint BIGINT,
      bool BOOLEAN,
      date DATE,
      timestamp TIMESTAMP,
      json JSONB,
      blob BYTEA,
      array_text TEXT[],
      array_number INT[],
      nested_array_float FLOAT[][],
      test_null INT,
      test_undefined INT
    );
  `)

      await db.query(
        `
    INSERT INTO test (text, number, float, bigint, bool, date, timestamp, json, blob, array_text, array_number, nested_array_float, test_null, test_undefined)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14);
  `,
        [
          'test',
          1,
          1.5,
          9223372036854775807n,
          true,
          new Date('2021-01-01'),
          new Date('2021-01-01T12:00:00'),
          { test: 'test' },
          Uint8Array.from([1, 2, 3]),
          ['test1', 'test2', 'test,3'],
          [1, 2, 3],
          [
            [1.1, 2.2],
            [3.3, 4.4],
          ],
          null,
          undefined,
        ],
      )

      const res = await db.query(`
    SELECT * FROM test;
  `)

      expect(res).toMatchObject({
        rows: [
          {
            id: 1,
            text: 'test',
            number: 1,
            float: 1.5,
            bigint: 9223372036854775807n,
            bool: true,
            date: new Date('2021-01-01T00:00:00.000Z'),
            json: { test: 'test' },
            blob: Uint8Array.from([1, 2, 3]),
            array_text: ['test1', 'test2', 'test,3'],
            array_number: [1, 2, 3],
            nested_array_float: [
              [1.1, 2.2],
              [3.3, 4.4],
            ],
            test_null: null,
            test_undefined: null,
          },
        ],
        fields: [
          {
            name: 'id',
            dataTypeID: 23,
          },
          {
            name: 'text',
            dataTypeID: 25,
          },
          {
            name: 'number',
            dataTypeID: 23,
          },
          {
            name: 'float',
            dataTypeID: 701,
          },
          {
            name: 'bigint',
            dataTypeID: 20,
          },
          {
            name: 'bool',
            dataTypeID: 16,
          },
          {
            name: 'date',
            dataTypeID: 1082,
          },
          {
            name: 'timestamp',
            dataTypeID: 1114,
          },
          {
            name: 'json',
            dataTypeID: 3802,
          },
          {
            name: 'blob',
            dataTypeID: 17,
          },
          {
            name: 'array_text',
            dataTypeID: 1009,
          },
          {
            name: 'array_number',
            dataTypeID: 1007,
          },
          {
            name: 'nested_array_float',
            dataTypeID: 1022,
          },
          {
            name: 'test_null',
            dataTypeID: 23,
          },
          {
            name: 'test_undefined',
            dataTypeID: 23,
          },
        ],
        affectedRows: 0,
      })

      // standardize timestamp comparison to UTC milliseconds to ensure predictable test runs on machines in different timezones.
      expect(res.rows[0].timestamp.getUTCMilliseconds()).toBe(
        new Date('2021-01-01T12:00:00.000Z').getUTCMilliseconds(),
      )
    })

    it('params', async () => {
      const db = new PGlite()
      await db.query(`
    CREATE TABLE IF NOT EXISTS test (
      id SERIAL PRIMARY KEY,
      name TEXT
    );
  `)
      await db.query('INSERT INTO test (name) VALUES ($1);', ['test2'])
      const res = await db.query(`
    SELECT * FROM test;
  `)

      expect(res).toEqual({
        rows: [
          {
            id: 1,
            name: 'test2',
          },
        ],
        fields: [
          {
            name: 'id',
            dataTypeID: 23,
          },
          {
            name: 'name',
            dataTypeID: 25,
          },
        ],
        affectedRows: 0,
      })
    })

    it('error', async () => {
      const db = new PGlite()
      await expectToThrowAsync(async () => {
        await db.query('SELECT * FROM test;')
      }, 'relation "test" does not exist')
    })

    it('transaction', async () => {
      const db = new PGlite()
      await db.query(`
    CREATE TABLE IF NOT EXISTS test (
      id SERIAL PRIMARY KEY,
      name TEXT
    );
  `)
      await db.query("INSERT INTO test (name) VALUES ('test');")
      await db.transaction(async (tx) => {
        await tx.query("INSERT INTO test (name) VALUES ('test2');")
        const res = await tx.query(`
      SELECT * FROM test;
    `)
        expect(res).toEqual({
          rows: [
            {
              id: 1,
              name: 'test',
            },
            {
              id: 2,
              name: 'test2',
            },
          ],
          fields: [
            {
              name: 'id',
              dataTypeID: 23,
            },
            {
              name: 'name',
              dataTypeID: 25,
            },
          ],
          affectedRows: 0,
        })
        await tx.rollback()
      })
      const res = await db.query(`
    SELECT * FROM test;
  `)
      expect(res).toEqual({
        rows: [
          {
            id: 1,
            name: 'test',
          },
        ],
        fields: [
          {
            name: 'id',
            dataTypeID: 23,
          },
          {
            name: 'name',
            dataTypeID: 25,
          },
        ],
        affectedRows: 0,
      })
    })

    it('copy to/from blob', async () => {
      const db = new PGlite()
      await db.exec(`
    CREATE TABLE IF NOT EXISTS test (
      id SERIAL PRIMARY KEY,
      test TEXT
    );
    INSERT INTO test (test) VALUES ('test'), ('test2');
  `)

      // copy to
      const ret = await db.query("COPY test TO '/dev/blob' WITH (FORMAT csv);")
      const csv = await ret.blob.text()
      expect(csv).toBe('1,test\n2,test2\n')

      // copy from
      const blob2 = new Blob([csv])
      await db.exec(`
    CREATE TABLE IF NOT EXISTS test2 (
      id SERIAL PRIMARY KEY,
      test TEXT
    );
  `)
      await db.query("COPY test2 FROM '/dev/blob' WITH (FORMAT csv);", [], {
        blob: blob2,
      })
      const res = await db.query(`
    SELECT * FROM test2;
  `)
      expect(res).toEqual({
        rows: [
          {
            id: 1,
            test: 'test',
          },
          {
            id: 2,
            test: 'test2',
          },
        ],
        fields: [
          {
            name: 'id',
            dataTypeID: 23,
          },
          {
            name: 'test',
            dataTypeID: 25,
          },
        ],
        affectedRows: 0,
      })
    })

    it('close', async () => {
      const db = new PGlite()
      await db.query(`
    CREATE TABLE IF NOT EXISTS test (
      id SERIAL PRIMARY KEY,
      name TEXT
    );
  `)
      await db.query("INSERT INTO test (name) VALUES ('test');")
      await db.close()
      await expectToThrowAsync(async () => {
        await db.query('SELECT * FROM test;')
      }, 'PGlite is closed')
    })
  })
}
