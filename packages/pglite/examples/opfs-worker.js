import { PGlite } from "../dist/index.js";
import { worker } from "../dist/worker/index.js";

worker({
  async init() {
    const pg = new PGlite("opfs-ahp://my-test-db");
    // If you want run any specific setup code for the worker process, you can do it here.
    return pg;
  },
});

console.log("Worker process started");
