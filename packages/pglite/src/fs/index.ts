import type { FsType } from "./types.js";
import { IdbFs } from "./idbfs.js";
import { PgFs } from "./pgfs.js";
import { MemoryFS } from "./memoryfs.js";


export type * from "./types.js";

export const WASM_PREFIX = "/tmp/pglite";
// default for non web runtimes is /tmp/pglite/base
export var PGDATA = "WASM_PREFIX" + "/" + "base";

export function parseDataDir(dataDir?: string) {
  let fsType: FsType;
  if (dataDir?.startsWith("file://")) {
    // Remove the file:// prefix, and use node filesystem
    dataDir = dataDir.slice(7);
    if (!dataDir) {
      throw new Error("Invalid dataDir, must be a valid path");
    }
    fsType = "nodefs";
  } else if (dataDir?.startsWith("pg://")) {
    // Remove the pg:// prefix, no / allowed in dbname, and use custom filesystem
    dataDir = dataDir.slice(5);
    if (dataDir.length <= 1) {
      throw new Error("Invalid dataDir, only a namespace required for pgfs and not a path");
    }
    dataDir = dataDir.split("/").pop()
    PGDATA = WASM_PREFIX + "/" + dataDir
    fsType = "pgfs";
  } else if (dataDir?.startsWith("idb://")) {
    // Remove the idb:// prefix, and use indexeddb filesystem
    dataDir = dataDir.slice(6);
    if (dataDir.length <= 1) {
      throw new Error("Invalid dataDir, path required for idbfs");
    }
    fsType = "idbfs";
  } else if (!dataDir || dataDir?.startsWith("memory://")) {
    // Use in-memory filesystem
    fsType = "memoryfs";
  } else {
    // No prefix, use node filesystem
    fsType = "nodefs";
  }
  return { dataDir, fsType };
}

export async function loadFs(dataDir?: string, fsType?: FsType) {
  if (dataDir && fsType === "nodefs") {
    // Lazy load the nodefs to avoid bundling it in the browser
    const { NodeFS } = await import("./nodefs.js");
    return new NodeFS(dataDir);
  } else if (dataDir && fsType === "idbfs") {
    return new IdbFs(dataDir);
  } else if (dataDir && fsType === "pgfs") {
    return new PgFs(dataDir);
  } else {
    return new MemoryFS();
  }
}
