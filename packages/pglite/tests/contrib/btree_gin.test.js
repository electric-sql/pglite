import test from "ava";
import { PGlite } from "../../dist/index.js";
import { btree_gin } from "../../dist/contrib/btree_gin.js";

test("btree_gin", async (t) => {
  const pg = new PGlite({
    extensions: {
      btree_gin,
    },
  });

  await pg.exec("CREATE EXTENSION IF NOT EXISTS btree_gin;");

  await pg.exec(`
    CREATE TABLE IF NOT EXISTS test (
      id SERIAL PRIMARY KEY,
      number int4
    );
    CREATE INDEX IF NOT EXISTS test_number_btree_gin_idx ON test USING GIN (number);
  `);

  await pg.exec("INSERT INTO test (number) VALUES (1);");
  await pg.exec("INSERT INTO test (number) VALUES (2);");
  await pg.exec("INSERT INTO test (number) VALUES (3);");

  const res = await pg.query(`
    SELECT
      number
    FROM test
    WHERE number = 1;
  `);

  t.deepEqual(res.rows, [
    {
      "number": 1,
    },
  ]);

  const res2 = await pg.query(`
    EXPLAIN ANALYZE
    SELECT
      number
    FROM test
    WHERE number = 1;
  `);

  // check that `test_number_btree_gin_idx` is in the plan
  const match = res2.rows.filter((row) => row["QUERY PLAN"].includes("test_number_btree_gin_idx"));
  t.true(match.length > 0);
});
