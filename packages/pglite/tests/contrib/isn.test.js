import test from "ava";
import { PGlite } from "../../dist/index.js";
import { isn } from "../../dist/contrib/isn.js";

test("bloom", async (t) => {
  const pg = new PGlite({
    extensions: {
      isn,
    },
  });

  await pg.exec("CREATE EXTENSION IF NOT EXISTS isn;");

  const ret1 = await pg.query("SELECT isbn('978-0-393-04002-9');");
  t.deepEqual(ret1.rows, [
    {
      "isbn": "0-393-04002-X"
    },
  ]);

  const ret2 = await pg.query("SELECT isbn13('0901690546');");
  t.deepEqual(ret2.rows, [
    {
      "isbn13": "978-0-901690-54-8"
    },
  ]);

  const ret3 = await pg.query("SELECT issn('1436-4522');");
  t.deepEqual(ret3.rows, [
    {
      "issn": "1436-4522"
    },
  ]);

  await pg.exec(`
    CREATE TABLE test (id isbn);
    INSERT INTO test VALUES('9780393040029');
  `)

  const ret4 = await pg.query("SELECT * FROM test;");
  t.deepEqual(ret4.rows, [
    {
      "id": "0-393-04002-X"
    },
  ]);
});
