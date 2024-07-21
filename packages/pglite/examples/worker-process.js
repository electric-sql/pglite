import { PGlite } from "../dist/index.js";
import { worker } from "../dist/worker/index.js";

const pg = await PGlite.create({
  extensions: {
    worker
  }
});

pg.worker.start();

console.log("Worker process started");
