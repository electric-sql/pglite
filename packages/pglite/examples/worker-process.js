import { PGlite } from "../dist/index.js";
import { worker } from "../dist/worker/index.js";

worker({
  async init() {
    return new PGlite();
  },
});

console.log("Worker process started");
