import { PGlite } from "../dist/index.js";

console.log("Starting...");
// In-memory database:
const pg = new PGlite({
  extensions: {
    lantern: {
      // this path should contain lantern.control, lantern--$version.sql and lantern.wasm files
      // the module_pathname in control file will be /absolute/path/to/lantern.wasm
      pathOrUrl: '../../../pglite/lantern/build',
      setup: () => null,
    },
  }
});

console.log("Waiting for ready...");
await pg.waitReady;

console.log("Ready!");

console.log("Creating extension...");
await pg.exec(`CREATE EXTENSION IF NOT EXISTS lantern;`);
console.log(await pg.exec(`SELECT * FROM pg_available_extensions`));

console.log("Creating table...");
await pg.exec(`
  CREATE TABLE small_world (
      id VARCHAR(3),
      b BOOLEAN,
      v REAL[3]
    );
  `);

console.log("Inserting data...");
await pg.exec(`
  INSERT INTO small_world (id, b, v) VALUES
      ('000', TRUE,  '{0,0,0}'),
      ('001', TRUE,  '{0,0,1}'),
      ('010', FALSE, '{0,1,0}'),
      ('011', TRUE,  '{0,1,1}'),
      ('100', FALSE, '{1,0,0}'),
      ('101', FALSE, '{1,0,1}'),
      ('110', FALSE, '{1,1,0}'),
      ('111', TRUE,  '{1,1,1}');
`);

console.log("Creating index...");
await pg.exec(`
  CREATE INDEX ON small_world USING lantern_hnsw (v) WITH (dim=3, M=5, ef=20, ef_construction=20);
  `);

console.log("Selecting data...");
await pg.exec("SET enable_seqscan=false");
console.log(await pg.exec("EXPLAIN SELECT * FROM small_world ORDER BY v <-> ARRAY[1,2,3];"));
console.log(await pg.exec("SELECT * FROM small_world ORDER BY v <-> ARRAY[1,2,3] LIMIT 10;"));

