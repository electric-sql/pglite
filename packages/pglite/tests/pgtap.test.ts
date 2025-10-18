import { describe, it, expect } from 'vitest'
import { testEsmCjsAndDTC } from './test-utils.ts'

await testEsmCjsAndDTC(async (importType) => {
  const { PGlite } =
    importType === 'esm'
      ? await import('../dist/index.js')
      : ((await import(
          '../dist/index.cjs'
        )) as unknown as typeof import('../dist/index.js'))

  const { pgtap } =
    importType === 'esm'
      ? await import('../dist/pgtap/index.js')
      : ((await import(
          '../dist/pgtap/index.cjs'
        )) as unknown as typeof import('../dist/pgtap/index.js'))

  describe(`pgtap`, () => {
    it('can load extension', async () => {
      const pg = new PGlite({
        extensions: {
          pgtap,
        },
      })

      await pg.exec('CREATE EXTENSION IF NOT EXISTS pgtap;')

      // Verify the extension is loaded
      const res = await pg.query<{ extname: string }>(`
        SELECT extname 
        FROM pg_extension 
        WHERE extname = 'pgtap'
      `)

      expect(res.rows).toHaveLength(1)
      expect(res.rows[0].extname).toBe('pgtap')
    })

    it('should run individual pgTAP assertions', async () => {
      const pg = new PGlite({
        extensions: {
          pgtap,
        },
      })

      await pg.exec('CREATE EXTENSION IF NOT EXISTS pgtap;')

      const res = await pg.exec(`
        -- Start transaction and plan the tests.
        BEGIN;
        SELECT plan(1);

        -- Run the tests.
        SELECT pass('This test passes');

        -- Finish the tests and clean up.
        SELECT * FROM finish();
        ROLLBACK;
      `)

      // we get 5 outputs, one for each SQL statement
      expect(res.length).toBe(5)
      expect(res[1].rows).toEqual([{ plan: '1..1' }])
      expect(res[2].rows).toEqual([{ pass: 'ok 1 - This test passes' }])
      
      // to issues reported in finish step
      expect(res[3].rows.length).toBe(0)
    })

    it('should check for correct amounts of tests', async () => {
      const pg = new PGlite({
        extensions: {
          pgtap,
        },
      })

      await pg.exec('CREATE EXTENSION IF NOT EXISTS pgtap;')

      const res = await pg.exec(`
        BEGIN;
        SELECT plan(1); -- wrong amount of tests
        SELECT pass('This test passes');
        SELECT pass('This test passes too');
        SELECT * FROM finish();
        ROLLBACK;
      `)

      expect(res.length).toBe(6)
      expect(res[1].rows).toEqual([{ plan: '1..1' }])
      expect(res[2].rows).toEqual([{ pass: 'ok 1 - This test passes' }])
      expect(res[3].rows).toEqual([{ pass: 'ok 2 - This test passes too' }])
      expect(res[4].rows).toEqual([
        {
          finish: '# Looks like you planned 1 test but ran 2',
        },
      ])
    })

    it('should run multiple tests', async () => {
      const pg = new PGlite({
        extensions: {
          pgtap,
        },
      })

      await pg.exec('CREATE EXTENSION IF NOT EXISTS pgtap;')

      const res = await pg.exec(`
          -- Start transaction and plan the tests.
          BEGIN;
          CREATE TABLE test_table (
            id    SERIAL NOT NULL PRIMARY KEY,
            name  TEXT DEFAULT ''
          );
          SELECT plan(4); -- set the wrong number of tests on purpose

          -- Test that public schema exists
          SELECT has_schema('public', 'public schema should exist');

          SELECT has_table('public', 'test_table', 'test_table should exist in public');

          -- Cause an error
          SELECT has_table('table_that_does_not_exist', 'this table should exist');

          -- Finish the tests and clean up.
          SELECT * FROM finish();
          ROLLBACK;
        `)

      expect(res.length).toBe(8)
      expect(res[2].rows).toEqual([{ plan: '1..4' }])
      expect(res[3].rows).toEqual([
        { has_schema: 'ok 1 - public schema should exist' },
      ])
      expect(res[4].rows).toEqual([
        { has_table: 'ok 2 - test_table should exist in public' },
      ])
      expect(res[5].rows).toEqual([
        {
          has_table:
            'not ok 3 - this table should exist\n# Failed test 3: "this table should exist"',
        },
      ])
      expect(res[6].rows).toEqual([
        { finish: '# Looks like you planned 4 tests but ran 3' },
      ])
    })

    it('should run pgTAP test suite', async () => {
      const pg = new PGlite({
        extensions: {
          pgtap,
        },
      })

      await pg.exec('CREATE EXTENSION IF NOT EXISTS pgtap;')

      const res = await pg.exec(`
          BEGIN;
          CREATE TABLE users (
            id    SERIAL NOT NULL PRIMARY KEY,
            name  TEXT DEFAULT ''
          );
          CREATE OR REPLACE FUNCTION setup_insert(
          ) RETURNS SETOF TEXT AS $$
          BEGIN
            RETURN NEXT is( MAX(name), NULL, 'Should have no users') FROM users;
            INSERT INTO users (name) VALUES ('tester');
            RETURN;
          END
          $$ LANGUAGE plpgsql;

          Create OR REPLACE FUNCTION test_user(
          ) RETURNS SETOF TEXT AS $$
            SELECT is( name, 'tester', 'Should have name') FROM users;
          $$ LANGUAGE sql;

          SELECT * FROM runtests();
          ROLLBACK;
        `)

      expect(res.length).toBe(6)
      // we don't care about the outputs of the other statements
      expect(res[4].rows).toEqual([
        { runtests: '# Subtest: public.test_user()' },
        { runtests: '    ok 1 - Should have no users' },
        { runtests: '    ok 2 - Should have name' },
        { runtests: '    1..2' },
        { runtests: 'ok 1 - public.test_user' },
        { runtests: '1..1' },
      ])
    })
  })
})
