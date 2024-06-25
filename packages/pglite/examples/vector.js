import { PGlite } from "../dist/index.js";
import { vector } from "../dist/vector/index.js";

const pg = new PGlite({
  extensions: {
    vector,
  }
});

await pg.exec("CREATE EXTENSION IF NOT EXISTS vector;");
await pg.exec(`
  CREATE TABLE IF NOT EXISTS test (
    id SERIAL PRIMARY KEY,
    name TEXT,
    vec vector(3)
  );
`);
await pg.exec("INSERT INTO test (name, vec) VALUES ('test1', '[1,2,3]');");
await pg.exec("INSERT INTO test (name, vec) VALUES ('test2', '[4,5,6]');");
await pg.exec("INSERT INTO test (name, vec) VALUES ('test3', '[7,8,9]');");

const res = await pg.exec(`
  SELECT * FROM test;
`);
console.log(res);

const res2 = await pg.exec(`
  SELECT
    name,
    vec,
    vec <-> '[3,1,2]' AS distance
  FROM test;
`);
console.log(res2);