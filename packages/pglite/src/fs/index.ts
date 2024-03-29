import type { FsType } from "./types.js";
import { IdbFs } from "./idbfs.js";
import { MemoryFS } from "./memoryfs.js";

export type * from "./types.js";

export const PGDATA = "/pgdata";

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
    if (!dataDir.startsWith("/")) {
      dataDir = "/" + dataDir;
    }
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
  } else {
    return new MemoryFS();
  }
}
