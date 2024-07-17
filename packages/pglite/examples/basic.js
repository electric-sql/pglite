import { PGlite } from "../dist/index.js";

console.log("Starting...");
const start = performance.now();
// In-memory database:
// const pg = new PGlite();
// Or, on-disk database:
// const pg = new PGlite('pgdata');
const pg = new PGlite('idb://pgdata');

console.log("Waiting for ready...");
await pg.waitReady;

console.log("Ready! Took", performance.now() - start, "ms");

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
