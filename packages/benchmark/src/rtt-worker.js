// Based on wa-sqlite's benchmarks
// Copyright 2021 Roy T. Hashimoto. All Rights Reserved.
// Modified by the PGLite authors.

import * as SQLite from './wa-sqlite/src/sqlite-api.js';
import { createTag } from "./wa-sqlite/src/examples/tag.js";
import { PGlite } from "./pglite/index.js";

const WA_SQLITE = './wa-sqlite/dist/wa-sqlite.mjs';
const WA_SQLITE_ASYNC = './wa-sqlite/dist/wa-sqlite-async.mjs';

(async function () {
  const Comlink = await import(
    "https://unpkg.com/comlink/dist/esm/comlink.mjs"
  );
  
  async function open(config) {
    if (config.db === 'wa-sqlite') {
      console.log('Opening SQLite database:', JSON.stringify(config, null, 2))
      return openSQLite(config);
    } else if (config.db === 'pglite') {
      console.log('Opening PGLite database:', JSON.stringify(config, null, 2))
      return openPGlite(config);
    }
  }
  
  async function openPGlite(config) {
    const pg = new PGlite(config.dataDir, config.options);
    await pg.waitReady;

    // Create the query interface.
    async function query(sql) {
      // console.log('Query:', sql);
      const startTime = performance.now();
      const ret = await pg.exec(sql);
      const elapsed = performance.now() - startTime;
      return { elapsed };
    }
    return Comlink.proxy(query);
  }

  async function openSQLite(config) {
    const { default: moduleFactory } = await import(config.isAsync ? WA_SQLITE_ASYNC : WA_SQLITE);
    const module = await moduleFactory();
    const sqlite3 = SQLite.Factory(module);

    if (config.vfsModule) {
      // Create the VFS and register it as the default file system.
      const namespace = await import(config.vfsModule);
      const vfs = new namespace[config.vfsClass](...config.vfsArgs ?? []);
      await vfs.isReady;
      sqlite3.vfs_register(vfs, true);
    }

    // Open the database;
    const db = await sqlite3.open_v2(config.dbName ?? 'rtt-demo');

    const tag = createTag(sqlite3, db);
    const query = async (sql) => {
      const startTime = performance.now();
      const ret = await tag(sql);
      const elapsed = performance.now() - startTime;
      return { elapsed };
    }
    return Comlink.proxy(query);
  }

  postMessage(null);
  Comlink.expose(open);
})();
