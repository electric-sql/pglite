import test from "ava";
import { PGlite } from "../dist/index.js";

test("dump data dir and load it", async (t) => {
  const pg1 = new PGlite();
  await pg1.exec(`
    CREATE TABLE IF NOT EXISTS test (
      id SERIAL PRIMARY KEY,
      name TEXT
    );
  `);
  pg1.exec("INSERT INTO test (name) VALUES ('test');");

  const ret1 = await pg1.query("SELECT * FROM test;");
  
  const file = await pg1.dumpDataDir();

  t.is(typeof file, "object");
  
  const pg2 = new PGlite({
    loadDataDir: file,
  });
  
  const ret2 = await pg2.query("SELECT * FROM test;");
  
  t.deepEqual(ret1, ret2);
});
