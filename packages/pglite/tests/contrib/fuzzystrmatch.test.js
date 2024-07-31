import test from "ava";
import { PGlite } from "../../dist/index.js";
import { fuzzystrmatch } from "../../dist/contrib/fuzzystrmatch.js";

test("fuzzystrmatch", async (t) => {
  const pg = new PGlite({
    extensions: {
      fuzzystrmatch,
    },
  });

  await pg.exec("CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;");

  const res = await pg.query(`
    SELECT
      levenshtein('kitten', 'sitting') AS distance;
  `);

  t.deepEqual(res.rows, [
    { distance: 3 },
  ]);

  const res2 = await pg.query(`
    SELECT
      soundex('kitten') AS soundex;
  `);

  t.deepEqual(res2.rows, [
    { soundex: "K350" },
  ]);
});
