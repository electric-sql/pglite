import test from "ava";
import { PGlite } from "../../dist/index.js";
import { seg } from "../../dist/contrib/seg.js";

test("seg", async (t) => {
  const pg = new PGlite({
    extensions: {
      seg,
    },
  });

  await pg.exec("CREATE EXTENSION IF NOT EXISTS seg;");

  const ret = await pg.query(`SELECT '6.25 .. 6.50'::seg AS "pH"`);
  t.deepEqual(ret.rows, [{ pH: "6.25 .. 6.50" }]);

  const ret2 = await pg.query(`SELECT '7(+-)1'::seg AS "set"`);
  t.deepEqual(ret2.rows, [{ set: "6 .. 8" }]);
});
