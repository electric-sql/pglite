import * as Comlink from "comlink";
import { PGlite, type PGliteOptions } from "../index.js";

let db: PGlite;

const worker = {
  async init(dataDir?: string, options?: PGliteOptions) {
    db = new PGlite(dataDir, options);
    await db.waitReady;
    return true;
  },
  async close() {
    await db.close();
  },
  async query(query: string, params?: any[]) {
    return await db.query(query, params);
  },
  async exec(query: string) {
    return await db.exec(query);
  },
  async transaction(callback: (tx: any) => Promise<any>) {
    return await db.transaction((tx) => {
      return callback(Comlink.proxy(tx));
    });
  },
  async execProtocol(message: Uint8Array) {
    return await db.execProtocol(message);
  },
}

Comlink.expose(worker);

export type Worker = typeof worker;
