import { PGlite } from "../dist/index.js";
import { pgDump } from "../../pglite-tools/dist/pg_dump.js";

console.log("Starting...");

const pg = await PGlite.create({ debug: 1 });

console.log("Creating table...");
await pg.exec(`
  CREATE TABLE IF NOT EXISTS test (
    id SERIAL PRIMARY KEY,
    name TEXT
  );
`);

await pg.exec("INSERT INTO test (name) VALUES ('test');");

console.log('Dumping database...')
const dump = await pgDump({ pg })
console.log(await dump.text())
