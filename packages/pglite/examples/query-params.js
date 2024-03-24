import { PGlite, types } from "../dist/index.js";

console.log("Starting...");
const pg = new PGlite();

console.log("Creating table...");
await pg.query(`
  CREATE TABLE IF NOT EXISTS test (
    id SERIAL PRIMARY KEY,
    name TEXT
  );
`);

console.log("Inserting data...");
await pg.query("INSERT INTO test (name) VALUES ($1);", ["test"]);
await pg.query("INSERT INTO test (name) VALUES ($1);", ["other"]);

console.log("Selecting data...");
const res = await pg.query(`
  SELECT * FROM test WHERE name = $1;
`, ["test"]);

console.log(res);

console.log("Selecting data with options...");
const res2 = await pg.query(`
  SELECT * FROM test WHERE name = $1;
`, ["test"], {
  rowMode: "array",
  parsers: {
    [types.TEXT]: (value) => value.toUpperCase(),
  }
});

console.log(res2);
