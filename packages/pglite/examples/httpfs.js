import { PGlite } from "../dist/index.js";
import { HttpFs } from "../dist/fs/http.js";

console.log("Starting PGLite...");
const pg = await PGlite.create({
  // debug: 1,
  fs: new HttpFs("http://localhost/pglite/examples/pgdata", { 
    // debug: true 
    fetchGranularity: 'file', // 'file' or 'page'
  }),
});

const start = performance.now();
console.log("Selecting data...");
const res = await pg.exec(`
  SELECT * FROM test;
`);
console.log(res);
console.log("Query Took", performance.now() - start, "ms");
