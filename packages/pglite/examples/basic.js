import { PGlite } from "../dist/index.js";

console.log("Starting...");
const pg = new PGlite();
// const pg = new PGlite('pgdata');

console.log("Waiting for ready...");
await pg.waitReady;

// process.exit(0);

console.log("Ready!");

console.log("Creating table...");
await pg.query(`
  CREATE TABLE IF NOT EXISTS test (
    id SERIAL PRIMARY KEY,
    name TEXT
  );
`);

console.log("Inserting data...");
await pg.query("INSERT INTO test (name) VALUES ('test');");

console.log("Selecting data...");
const res = await pg.query(`
  SELECT * FROM test;
`);

console.log(res);

// try {
//   await pg.query('1');
// } catch (e) {
//   console.log('Error caught:');
//   console.log(e);
// }

console.log(await pg.query("SELECT * FROM test;"));

// Test transaction

await pg.query("BEGIN;");
await pg.query("INSERT INTO test (name) VALUES ('test2');");
await pg.query("ROLLBACK;");
console.log(await pg.query("SELECT * FROM test;"));

await pg.query("BEGIN;");
await pg.query("INSERT INTO test (name) VALUES ('test3');");
await pg.query("COMMIT;");
console.log(await pg.query("SELECT * FROM test;"));

console.log("Closing...");
await pg.close();

// async timeout 1s
await new Promise((resolve) => setTimeout(resolve, 1000));
