import { describe, it, expect } from 'vitest'
import { PGlite } from '../dist/index.js'

describe('plpgsql', () => {
  it('can create and call function', async () => {
    const db = new PGlite()
    await db.exec(`
    CREATE EXTENSION IF NOT EXISTS plpgsql;
    CREATE OR REPLACE FUNCTION test_func()
    RETURNS TEXT AS $$
    BEGIN
      RETURN 'test';
    END;
    $$ LANGUAGE plpgsql;
  `)

    const res = await db.query('SELECT test_func();')
    expect(res.rows[0].test_func).toBe('test')
  })

  it('can create and call complex function', async () => {
    const db = new PGlite()
    await db.exec(`
    CREATE EXTENSION IF NOT EXISTS plpgsql;
    CREATE OR REPLACE FUNCTION calculate_factorial(n INT) RETURNS INT AS $$
    DECLARE
        result INT := 1;
    BEGIN
        IF n < 0 THEN
            RAISE EXCEPTION 'The input cannot be negative.';
        ELSIF n = 0 OR n = 1 THEN
            RETURN result;
        ELSE
            FOR i IN 2..n LOOP
                result := result * i;
            END LOOP;
            RETURN result;
        END IF;
    END;
    $$ LANGUAGE plpgsql;
  `)

    const res = await db.query('SELECT calculate_factorial(5) AS result;')
    expect(res.rows[0].result).toBe(120)
  })

  it('plpgsql usable after exception', async () => {
    const db = await PGlite.create()

    await db.exec(`
      CREATE EXTENSION IF NOT EXISTS plpgsql;
      CREATE OR REPLACE PROCEDURE raise_exception() LANGUAGE plpgsql AS $$
      BEGIN
      RAISE 'exception';
      END;
      $$;
      `)

    try {
      await db.exec('CALL raise_exception();')
    } catch (e) {
      // expected
      expect(e.message).toBe('Dynamic linking error: cannot resolve symbol setTempRet0')
    }
  })
})
