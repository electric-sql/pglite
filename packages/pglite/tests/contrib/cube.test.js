import test from "ava";
import { PGlite } from "../../dist/index.js";
import { cube } from "../../dist/contrib/cube.js";

test("cube", async (t) => {
  const pg = new PGlite({
    extensions: {
      cube,
    },
  });

  await pg.exec("CREATE EXTENSION IF NOT EXISTS cube;");

  await pg.exec(`
    CREATE TABLE IF NOT EXISTS test (
      id SERIAL PRIMARY KEY,
      point CUBE
    );
  `);

  await pg.exec("INSERT INTO test (point) VALUES ('(1, 2, 3)');");
  await pg.exec("INSERT INTO test (point) VALUES ('(4, 5, 6)');");
  await pg.exec("INSERT INTO test (point) VALUES ('(7, 8, 9)');");

  const res = await pg.query(`
    SELECT
      point,
      point <-> cube(array[1, 2, 3]) AS distance
    FROM test;
  `);

  t.deepEqual(res.rows, [
    { point: "(1, 2, 3)", distance: 0 },
    { point: "(4, 5, 6)", distance: 5.196152422706632 },
    { point: "(7, 8, 9)", distance: 10.392304845413264 },
  ]);
});
