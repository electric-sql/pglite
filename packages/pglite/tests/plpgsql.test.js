import test from "ava";
import { PGlite } from "../dist/index.js";

test("can create and call function", async (t) => {
  const db = new PGlite();
  await db.exec(`
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
