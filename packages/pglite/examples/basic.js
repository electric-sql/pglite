import { PGlite } from "../dist/index.js";

console.log("Starting...");
// In-memory database:
const pg = new PGlite({debug:1});
// Or, on-disk database:
// const pg = new PGlite('pgdata');

console.log("Waiting for ready...");
await pg.waitReady;

console.log("Ready!");

console.log("Creating table...");
await pg.exec(`
  CREATE TABLE IF NOT EXISTS test (
    id SERIAL PRIMARY KEY,
    name TEXT
  );
`);

console.log("Inserting data...");
await pg.exec("INSERT INTO test (name) VALUES ('test');");

console.log("Selecting data...");
const res = await pg.exec(`
  SELECT * FROM test;
`);

console.log(res);

console.log(await pg.exec("SELECT * FROM test;"));
