// Based on wa-sqlite's benchmarks
// Copyright 2021 Roy T. Hashimoto. All Rights Reserved.
// Modified by the PGLite authors.

import { PGlite } from "../pglite/dist/index.js";

(async function() {
  const Comlink = await import('https://unpkg.com/comlink/dist/esm/comlink.mjs');

  /**
   * @param {Config} config
   * @returns {Promise<Function>}
   */
  async function open(config) {
    const pg = new PGlite(config.dataDir);
    await pg.waitReady;

    // Create the query interface.
    async function query(sql) {
      // console.log('Query:', sql);
      const ret = await pg.query(sql);
      console.log(ret);
      return ret;
    }
    return Comlink.proxy(query);
  }

  postMessage(null);
  Comlink.expose(open);
})();

