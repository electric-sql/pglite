import test from "ava";
import { PGlite } from "../dist/index.js";

test("large objects", async (t) => {
  const pg = new PGlite();

  const text = "hello world";
  const blob = new Blob([text], { type: "text/plain" });

  await pg.exec(`
    CREATE TABLE test (id SERIAL PRIMARY KEY, data OID);
  `);

  await pg.query(`
    INSERT INTO test (data) VALUES (lo_import('/dev/blob'));
  `, [], {
    blob,
  });

  const res = await pg.query(`
    SELECT lo_export(data, '/dev/blob') AS data FROM test;
  `);

  const data = res.blob;
  const asText = await data.text();
  t.is(asText, text);
});
