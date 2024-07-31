import test from "ava";
import { PGlite } from "../../dist/index.js";
import { tsm_system_rows } from "../../dist/contrib/tsm_system_rows.js";

test("tsm_system_rows", async (t) => {
  const pg = new PGlite({
    extensions: {
      tsm_system_rows,
    },
  });

  await pg.exec("CREATE EXTENSION IF NOT EXISTS tsm_system_rows;");

  // crate test table with 10 rows
  await pg.exec(`
    CREATE TABLE test (
      id SERIAL PRIMARY KEY,
      name TEXT
    );
  `);
  
  await pg.exec(`
    INSERT INTO test (name)
    SELECT 'test' || i
    FROM generate_series(1, 10) AS i;
  `);

  // sample 5 rows
  const res = await pg.query(`
    SELECT *
    FROM test
    TABLESAMPLE SYSTEM_ROWS(5);
  `);

  t.is(res.rows.length, 5);
});
