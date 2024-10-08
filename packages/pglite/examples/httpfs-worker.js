import { PGlite } from "../dist/index.js";
import { worker } from "../dist/worker/index.js";
import { HttpFs } from "../dist/fs/http/browser.js";

console.log("Starting worker...");

worker({
  async init() {
    const start = performance.now();
    const pg = await PGlite.create({
      // debug: 1,
      fs: new HttpFs("/pglite/examples/pgdata", { 
        // debug: true 
        fetchGranularity: 'page', // 'file' or 'page'
      }),
    });
    console.log("PGlite initialized in", performance.now() - start, "ms");
    // If you want run any specific setup code for the worker process, you can do it here.
    return pg;
  },
});

console.log("Worker process started");
