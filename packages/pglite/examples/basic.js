import { PGlite } from "../dist/index.js";

console.log("Starting...");
const pg = new PGlite();
// const pg = new PGlite('pgdata');

console.log("Waiting for ready...");
await pg.waitReady;

// process.exit(0);

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

// try {
//   await pg.exec('1');
// } catch (e) {
//   console.log('Error caught:');
//   console.log(e);
// }

console.log(await pg.exec("SELECT * FROM test;"));

// Test transaction

await pg.exec("BEGIN;");
await pg.exec("INSERT INTO test (name) VALUES ('test2');");
await pg.exec("ROLLBACK;");
console.log(await pg.exec("SELECT * FROM test;"));

await pg.exec("BEGIN;");
await pg.exec("INSERT INTO test (name) VALUES ('test3');");
await pg.exec("COMMIT;");
console.log(await pg.exec("SELECT * FROM test;"));

console.log("Closing...");
await pg.close();

// async timeout 1s
await new Promise((resolve) => setTimeout(resolve, 1000));
