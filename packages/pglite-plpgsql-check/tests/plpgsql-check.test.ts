import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { plpgsql_check } from '../src/index.js'

interface CheckResult {
  functionid: string
  lineno: number | null
  statement: string | null
  sqlstate: string
  message: string
  detail: string | null
  hint: string | null
  level: string
  position: number | null
  query: string | null
  context: string | null
}

describe(`plpgsql_check`, () => {
  let pg: PGlite
  let dataDirArchive: File | Blob

  beforeEach(async () => {
    if (!dataDirArchive) {
      pg = await PGlite.create({
        extensions: { plpgsql_check },
      })
      await pg.exec('CREATE EXTENSION plpgsql_check;')
      dataDirArchive = await pg.dumpDataDir('gzip')
    } else {
      pg = await PGlite.create({
        extensions: { plpgsql_check },
        loadDataDir: dataDirArchive,
      })
    }
  })

  afterEach(async () => {
    if (!pg.closed) {
      await pg.close()
    }
  })

  it('can load extension', async () => {
    const res = await pg.query<{ extname: string; extversion: string }>(`
      SELECT extname, extversion
      FROM pg_extension
      WHERE extname = 'plpgsql_check'
    `)

    expect(res.rows).toHaveLength(1)
    expect(res.rows[0].extname).toBe('plpgsql_check')
    expect(res.rows[0].extversion).toBe('2.10')
  })

  it('diagnoses a known invalid function', async () => {
    await pg.exec(`
      CREATE TABLE t1(a integer, b integer);

      CREATE OR REPLACE FUNCTION public.invalid_function()
      RETURNS void
      LANGUAGE plpgsql
      AS $$
      DECLARE
        r record;
      BEGIN
        FOR r IN SELECT * FROM t1 LOOP
          RAISE NOTICE '%', r.missing_column;
        END LOOP;
      END;
      $$;
    `)

    const res = await pg.query<CheckResult>(`
      SELECT *
      FROM plpgsql_check_function_tb('public.invalid_function()');
    `)

    expect(res.rows.length).toBeGreaterThan(0)

    const errorRow = res.rows.find((r) => r.sqlstate === '42703')
    expect(errorRow).toBeDefined()
    expect(errorRow!.sqlstate).toBe('42703')
    expect(errorRow!.message).toContain('missing_column')
    expect(errorRow!.lineno).toBeGreaterThan(0)
    expect(errorRow!.statement).toBeTruthy()
    expect(errorRow!.level).toBe('error')
  })

  it('reports no errors for a valid function', async () => {
    await pg.exec(`
      CREATE TABLE t2(a integer, b integer);

      CREATE OR REPLACE FUNCTION public.valid_function()
      RETURNS void
      LANGUAGE plpgsql
      AS $$
      DECLARE
        r record;
      BEGIN
        FOR r IN SELECT * FROM t2 LOOP
          RAISE NOTICE '%', r.a;
        END LOOP;
      END;
      $$;
    `)

    const res = await pg.query<CheckResult>(`
      SELECT *
      FROM plpgsql_check_function_tb('public.valid_function()');
    `)

    const errorRows = res.rows.filter((r) => r.level === 'error')
    expect(errorRows).toHaveLength(0)
  })

  it('works after dumpDataDir/loadDataDir round trip', async () => {
    await pg.exec(`
      CREATE TABLE t3(a integer);

      CREATE OR REPLACE FUNCTION public.invalid_function_2()
      RETURNS void
      LANGUAGE plpgsql
      AS $$
      DECLARE
        r record;
      BEGIN
        FOR r IN SELECT * FROM t3 LOOP
          RAISE NOTICE '%', r.nope;
        END LOOP;
      END;
      $$;
    `)

    const dataDir = await pg.dumpDataDir('gzip')
    await pg.close()

    const pg2 = await PGlite.create({
      extensions: { plpgsql_check },
      loadDataDir: dataDir,
    })

    const extRes = await pg2.query<{ extname: string }>(`
      SELECT extname FROM pg_extension WHERE extname = 'plpgsql_check'
    `)
    expect(extRes.rows).toHaveLength(1)

    const res = await pg2.query<CheckResult>(`
      SELECT *
      FROM plpgsql_check_function_tb('public.invalid_function_2()');
    `)

    const errorRow = res.rows.find((r) => r.sqlstate === '42703')
    expect(errorRow).toBeDefined()
    expect(errorRow!.message).toContain('nope')

    await pg2.close()
  })

  it('works in multiple independent instances', async () => {
    const pgA = await PGlite.create({
      extensions: { plpgsql_check },
    })
    const pgB = await PGlite.create({
      extensions: { plpgsql_check },
    })

    await pgA.exec('CREATE EXTENSION plpgsql_check;')
    await pgB.exec('CREATE EXTENSION plpgsql_check;')

    await pgA.exec(`
      CREATE TABLE ta(a integer);
      CREATE OR REPLACE FUNCTION public.bad_a()
      RETURNS void LANGUAGE plpgsql AS $$
      DECLARE r record;
      BEGIN
        FOR r IN SELECT * FROM ta LOOP
          RAISE NOTICE '%', r.missing_a;
        END LOOP;
      END;
      $$;
    `)

    await pgB.exec(`
      CREATE TABLE tb(b integer);
      CREATE OR REPLACE FUNCTION public.bad_b()
      RETURNS void LANGUAGE plpgsql AS $$
      DECLARE r record;
      BEGIN
        FOR r IN SELECT * FROM tb LOOP
          RAISE NOTICE '%', r.missing_b;
        END LOOP;
      END;
      $$;
    `)

    const [resA, resB] = await Promise.all([
      pgA.query<CheckResult>(
        `SELECT * FROM plpgsql_check_function_tb('public.bad_a()')`,
      ),
      pgB.query<CheckResult>(
        `SELECT * FROM plpgsql_check_function_tb('public.bad_b()')`,
      ),
    ])

    const errA = resA.rows.find((r) => r.sqlstate === '42703')
    const errB = resB.rows.find((r) => r.sqlstate === '42703')
    expect(errA).toBeDefined()
    expect(errA!.message).toContain('missing_a')
    expect(errB).toBeDefined()
    expect(errB!.message).toContain('missing_b')

    await pgA.close()
    await pgB.close()
  })

  it('handles transactional rollback without leaking state', async () => {
    await pg.exec(`
      CREATE TABLE t4(a integer);
    `)

    await pg.query(`BEGIN`)
    await pg.exec(`
      CREATE OR REPLACE FUNCTION public.txn_invalid()
      RETURNS void LANGUAGE plpgsql AS $$
      DECLARE r record;
      BEGIN
        FOR r IN SELECT * FROM t4 LOOP
          RAISE NOTICE '%', r.missing_txn;
        END LOOP;
      END;
      $$;
    `)

    const res = await pg.query<CheckResult>(`
      SELECT * FROM plpgsql_check_function_tb('public.txn_invalid()')
    `)
    expect(res.rows.find((r) => r.sqlstate === '42703')).toBeDefined()

    await pg.query(`ROLLBACK`)

    const fnExists = await pg.query<{ exists: boolean }>(`
      SELECT EXISTS(
        SELECT 1 FROM pg_proc WHERE proname = 'txn_invalid'
      ) as exists
    `)
    expect(fnExists.rows[0].exists).toBe(false)

    const sanity = await pg.query<{ val: number }>(`SELECT 1 as val`)
    expect(sanity.rows[0].val).toBe(1)
  })

  it('handles schema-qualified regprocedure signatures', async () => {
    await pg.exec(`
      CREATE TABLE t5(a integer, b integer);

      CREATE OR REPLACE FUNCTION public.calculate(a integer)
      RETURNS integer
      LANGUAGE plpgsql
      AS $$
      BEGIN
        RETURN a + 1;
      END;
      $$;

      CREATE OR REPLACE FUNCTION public.calculate(a integer, b integer)
      RETURNS integer
      LANGUAGE plpgsql
      AS $$
      BEGIN
        RETURN a + b;
      END;
      $$;
    `)

    const res = await pg.query<CheckResult>(`
      SELECT *
      FROM plpgsql_check_function_tb('public.calculate(integer)'::regprocedure);
    `)

    const errorRows = res.rows.filter((r) => r.level === 'error')
    expect(errorRows).toHaveLength(0)

    const res2 = await pg.query<CheckResult>(`
      SELECT *
      FROM plpgsql_check_function_tb('public.calculate(integer,integer)'::regprocedure);
    `)

    const errorRows2 = res2.rows.filter((r) => r.level === 'error')
    expect(errorRows2).toHaveLength(0)
  })
})
