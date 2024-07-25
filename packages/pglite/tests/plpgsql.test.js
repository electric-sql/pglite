import test from "ava";
import { PGlite } from "../dist/index.js";

test("can create and call function", async (t) => {
  const db = new PGlite();
  await db.exec(`
    CREATE EXTENSION IF NOT EXISTS plpgsql;
    CREATE OR REPLACE FUNCTION test_func()
    RETURNS TEXT AS $$
    BEGIN
      RETURN 'test';
    END;
    $$ LANGUAGE plpgsql;
  `);

  const res = await db.query("SELECT test_func();");
  t.is(res.rows[0].test_func, "test");
});

test("can create and call complex function", async (t) => {
  const db = new PGlite();
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
  `);

  const res = await db.query("SELECT calculate_factorial(5) AS result;");
  t.is(res.rows[0].result, 120);
});
