import { PGlite } from "../dist/index.js";

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

console.log("Selecting data...");
const res = await pg.query(`
  SELECT * FROM test;
`);

console.log(res);
