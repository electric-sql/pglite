import { PGlite } from "../../../dist/index.js";
import { worker } from "../../../dist/worker/index.js";

worker({
  async init(options) {
    return new PGlite({
      dataDir: options.dataDir,
    });
  },
});
