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
  
  const { tarball, filename, extension } = await pg1.dumpDataDir();

  t.is(typeof tarball, "object");
  t.is(typeof filename, "string");
  t.is(typeof extension, "string");
  
  const pg2 = new PGlite({
    // debug: 1,
    loadDataDir: { tarball, extension },
  });
  
  const ret2 = await pg2.query("SELECT * FROM test;");
  
  t.deepEqual(ret1, ret2);
});
