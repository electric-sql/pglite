import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { pgmq } from '../src/index.js'

describe(`pgmq`, () => {
  let pg: PGlite
  let dataDirArchive: File | Blob
  beforeEach(async () => {
    if (!dataDirArchive) {
      pg = await PGlite.create({
        extensions: { pgmq },
      })
      dataDirArchive = await pg.dumpDataDir('gzip')
    } else {
      pg = await PGlite.create({
        extensions: { pgmq },
        loadDataDir: dataDirArchive,
      })
    }
    await pg.exec('CREATE EXTENSION IF NOT EXISTS pgmq;')
  })
  afterEach(async () => {
    if (!pg.closed) {
      await pg.close()
    }
  })

  it('can load extension', async () => {
    // Verify the extension is loaded
    const res = await pg.query<{ extname: string }>(`
        SELECT extname 
        FROM pg_extension 
        WHERE extname = 'pgmq'
      `)

    expect(res.rows).toHaveLength(1)
    expect(res.rows[0].extname).toBe('pgmq')
  })

  it('should send and receive a message', async () => {
    const res = await pg.exec(`
        SELECT pgmq.create('my_queue');
      `)

    expect(res).toEqual([
      {
        rows: [
          {
            create: '',
          },
        ],
        fields: [
          {
            name: 'create',
            dataTypeID: 2278,
          },
        ],
        affectedRows: 0,
      },
    ])

    const res1 = await pg.exec(`
SELECT * from pgmq.send(
  queue_name  => 'my_queue',
  msg         => '{"foo": "bar1"}'
);`)

    expect(res1).toEqual([
      {
        rows: [
          {
            send: 1,
          },
        ],
        fields: [
          {
            name: 'send',
            dataTypeID: 20,
          },
        ],
        affectedRows: 0,
      },
    ])

    const res2 = await pg.exec(`
      SELECT * FROM pgmq.read(
  queue_name => 'my_queue',
  vt         => 30,
  qty        => 2
);`)

    expect(res2[0].rows[0].message.foo).toEqual('bar1')
  })

  // it('should check for correct amounts of tests', async () => {
  //   const res = await pg.exec(`
  //       BEGIN;
  //       SELECT plan(1); -- wrong amount of tests
  //       SELECT pass('This test passes');
  //       SELECT pass('This test passes too');
  //       SELECT * FROM finish();
  //       ROLLBACK;
  //     `)

  //   expect(res.length).toBe(6)
  //   expect(res[1].rows).toEqual([{ plan: '1..1' }])
  //   expect(res[2].rows).toEqual([{ pass: 'ok 1 - This test passes' }])
  //   expect(res[3].rows).toEqual([{ pass: 'ok 2 - This test passes too' }])
  //   expect(res[4].rows).toEqual([
  //     {
  //       finish: '# Looks like you planned 1 test but ran 2',
  //     },
  //   ])
  // })

  // it('should run multiple tests', async () => {
  //   const res = await pg.exec(`
  //         -- Start transaction and plan the tests.
  //         BEGIN;
  //         CREATE TABLE test_table (
  //           id    SERIAL NOT NULL PRIMARY KEY,
  //           name  TEXT DEFAULT ''
  //         );
  //         SELECT plan(4); -- set the wrong number of tests on purpose

  //         -- Test that public schema exists
  //         SELECT has_schema('public', 'public schema should exist');

  //         SELECT has_table('public', 'test_table', 'test_table should exist in public');

  //         -- Cause an error
  //         SELECT has_table('table_that_does_not_exist', 'this table should exist');

  //         -- Finish the tests and clean up.
  //         SELECT * FROM finish();
  //         ROLLBACK;
  //       `)

  //   expect(res.length).toBe(8)
  //   expect(res[2].rows).toEqual([{ plan: '1..4' }])
  //   expect(res[3].rows).toEqual([
  //     { has_schema: 'ok 1 - public schema should exist' },
  //   ])
  //   expect(res[4].rows).toEqual([
  //     { has_table: 'ok 2 - test_table should exist in public' },
  //   ])
  //   expect(res[5].rows).toEqual([
  //     {
  //       has_table:
  //         'not ok 3 - this table should exist\n# Failed test 3: "this table should exist"',
  //     },
  //   ])
  //   expect(res[6].rows).toEqual([
  //     { finish: '# Looks like you planned 4 tests but ran 3' },
  //   ])
  // })
})
