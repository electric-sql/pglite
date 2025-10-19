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
      // we don't care about the outputs of the other SQL statements before
      expect(res[4].rows).toEqual([
        { runtests: '# Subtest: public.test_user()' },
        { runtests: '    ok 1 - Should have no users' },
        { runtests: '    ok 2 - Should have name' },
        { runtests: '    1..2' },
        { runtests: 'ok 1 - public.test_user' },
        { runtests: '1..1' },
      ])
    })

    it('should run in-depth assertion tests', async () => {
      const pg = new PGlite({
        extensions: {
          pgtap,
        },
      })

      await pg.exec('CREATE EXTENSION IF NOT EXISTS pgtap;')

      const res = await pg.exec(`
          BEGIN;

          -- Create test user and grant privileges
          CREATE USER testuser WITH PASSWORD 'testpass';
          GRANT CONNECT ON DATABASE postgres TO testuser;
          GRANT TEMPORARY ON DATABASE postgres TO testuser;
          GRANT CREATE ON DATABASE postgres TO testuser;
          

          -- Create tables and sample data
          CREATE TABLE users (
              id SERIAL PRIMARY KEY,
              name TEXT NOT NULL,
              email TEXT UNIQUE,
              age INTEGER CHECK (age >= 0),
              created_at TIMESTAMP DEFAULT NOW()
          );

          CREATE TABLE expected_users (
              id SERIAL PRIMARY KEY,
              name TEXT NOT NULL,
              email TEXT UNIQUE,
              age INTEGER CHECK (age >= 0),
              created_at TIMESTAMP DEFAULT NOW()
          );

          CREATE TABLE large_table (
              id SERIAL PRIMARY KEY,
              indexed_col INTEGER,
              data TEXT
          );

          CREATE INDEX idx_large_table ON large_table(indexed_col);

          -- Insert sample data
          INSERT INTO users (name, email, age) VALUES 
              ('alice', 'alice@example.com', 30),
              ('bob', 'bob@example.com', 25),
              ('charlie', 'charlie@example.com', 35);
          
          INSERT INTO expected_users (name, email, age) VALUES 
              ('alice', 'alice@example.com', 30),
              ('bob', 'bob@example.com', 25),
              ('charlie', 'charlie@example.com', 35);
          
          INSERT INTO large_table (indexed_col, data)
          SELECT i, 'data_' || i FROM generate_series(1, 1000) i;
          
          -- Plan the number of tests
          SELECT plan(9);
          
          -- 1. results_eq() - Query result comparison
          SELECT results_eq(
              'SELECT name, email, age FROM users ORDER BY id',
              'SELECT name, email, age FROM expected_users ORDER BY id',
              'Users table should match expected results'
          );
          
          -- 2. set_eq() - Set comparison (order doesn't matter)
          SELECT set_eq(
              'SELECT name FROM users',
              ARRAY['alice', 'bob', 'charlie'],
              'Should have exactly these users (any order)'
          );
          
          -- 3. bag_eq() - Bag comparison (allows duplicates)
          SELECT bag_eq(
              'SELECT name FROM users WHERE age > 20',
              ARRAY['alice', 'bob', 'charlie'],
              'Should have these users with age > 20'
          );
          
          -- 4. throws_ok() - Exception testing
          SELECT throws_ok(
              'INSERT INTO users (id, name) VALUES (NULL, ''test'')',
              '23502',
              'null value in column "id" of relation "users" violates not-null constraint',
              'Should enforce NOT NULL constraint on id'
          );
          
          -- 5. Another throws_ok() - Check constraint violation
          SELECT throws_ok(
              'INSERT INTO users (name, age) VALUES (''invalid'', -5)',
              '23514',
              'new row for relation "users" violates check constraint "users_age_check"',
              'Should enforce CHECK constraint on age'
          );
          
          -- 6. performs_ok() - Performance testing
          SELECT performs_ok(
              'SELECT * FROM large_table WHERE indexed_col = 123',
              1000,
              'Indexed query should complete within 1 second'
          );
          
          -- 7. has_table() - Schema verification
          SELECT has_table('users', 'Should have users table');
          
          -- 8. col_type_is() - Column type verification
          SELECT col_type_is(
              'users',
              'email',
              'text',
              'email column should be TEXT type'
          );
          
          -- 9. database_privs_are() - Privilege verification
          SELECT database_privs_are(
              'postgres',
              'testuser',
              ARRAY['CONNECT', 'TEMPORARY', 'CREATE'],
              'testuser should have specific database privileges'
          );
         
          SELECT * FROM finish();
          ROLLBACK;
        `)

      expect(res.length).toBe(24)
      // we don't care about the outputs of the other SQL statements before
      expect(res[12].rows).toEqual([{ plan: '1..9' }])
      expect(res[13].rows).toEqual([
        { results_eq: 'ok 1 - Users table should match expected results' },
      ])
      expect(res[14].rows).toEqual([
        { set_eq: 'ok 2 - Should have exactly these users (any order)' },
      ])
      expect(res[15].rows).toEqual([
        { bag_eq: 'ok 3 - Should have these users with age > 20' },
      ])
      expect(res[16].rows).toEqual([
        { throws_ok: 'ok 4 - Should enforce NOT NULL constraint on id' },
      ])
      expect(res[17].rows).toEqual([
        { throws_ok: 'ok 5 - Should enforce CHECK constraint on age' },
      ])
      expect(res[18].rows).toEqual([
        {
          performs_ok: 'ok 6 - Indexed query should complete within 1 second',
        },
      ])
      expect(res[19].rows).toEqual([
        { has_table: 'ok 7 - Should have users table' },
      ])
      expect(res[20].rows).toEqual([
        { col_type_is: 'ok 8 - email column should be TEXT type' },
      ])
      expect(res[21].rows).toEqual([
        {
          database_privs_are:
            'ok 9 - testuser should have specific database privileges',
        },
      ])
    })
  })
})
