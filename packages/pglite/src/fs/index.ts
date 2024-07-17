import type { FsType, Filesystem } from "./types.js";
import { IdbFs } from "./idbfs.js";
import { MemoryFS } from "./memoryfs.js";
import { Opfs, OpfsAhpFS } from "./opfs/index.js";

export type * from "./types.js";

export const WASM_PREFIX = "/tmp/pglite";
export const PGDATA = WASM_PREFIX + "/" + "base";

export function parseDataDir(dataDir?: string) {
  let fsType: FsType;
  if (dataDir?.startsWith("file://")) {
    // Remove the file:// prefix, and use node filesystem
    dataDir = dataDir.slice(7);
    if (!dataDir) {
      throw new Error("Invalid dataDir, must be a valid path");
    }
    fsType = "nodefs";
  } else if (dataDir?.startsWith("idb://")) {
    // Remove the idb:// prefix, and use indexeddb filesystem
    dataDir = dataDir.slice(6);
    fsType = "idbfs";
  } else if (dataDir?.startsWith("opfs-worker://")) {
    // Remove the opfs:// prefix, and use opfs filesystem
    dataDir = dataDir.slice(14);
    fsType = "opfs-worker";
  } else if (dataDir?.startsWith("opfs-ahp://")) {
    // Remove the opfsahp:// prefix, and use opfs access handle pool filesystem
    dataDir = dataDir.slice(11);
    fsType = "opfs-ahp";
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
  let fs: Filesystem;
  if (dataDir && fsType === "nodefs") {
    // Lazy load the nodefs to avoid bundling it in the browser
    const { NodeFS } = await import("./nodefs.js");
    fs = new NodeFS(dataDir);
  } else if (dataDir && fsType === "idbfs") {
    fs = new IdbFs(dataDir);
  } else if (dataDir && fsType === "opfs-worker") {
    fs = new Opfs(dataDir);
  } else if (dataDir && fsType === "opfs-ahp") {
    fs = new OpfsAhpFS(dataDir);
  } else {
    fs = new MemoryFS();
  }
  return fs;
}
