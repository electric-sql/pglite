import { tar, untar, type TarFile, REGTYPE, DIRTYPE } from "tinytar";
import { FS } from "../postgres.js";
import { PGDATA } from "./index.js";

export interface DumpedTar {
  tarball: Uint8Array;
  extension: ".tar" | ".tgz";
}

export async function dumpTar(FS: FS): Promise<DumpedTar> {
  const tarball = createTarball(FS, PGDATA);
  const [compressed, zipped] = await maybeZip(tarball);
  return {
    tarball: compressed,
    extension: zipped ? ".tgz" : ".tar",
  };
}

export async function loadTar(FS: FS, dump: DumpedTar): Promise<void> {
  let tarball = dump.tarball;
  console.log("loading tarball");
  if (dump.extension === ".tgz") {
    tarball = await unzip(tarball);
  }

  const files = untar(tarball);
  for (const file of files) {
    const filePath = PGDATA + file.name;

    // Ensure the directory structure exists
    const dirPath = filePath.split("/").slice(0, -1);
    for (let i = 1; i <= dirPath.length; i++) {
      const dir = dirPath.slice(0, i).join("/");
      if (!FS.analyzePath(dir).exists) {
        FS.mkdir(dir);
      }
    }

    // Write the file or directory
    if (file.type == REGTYPE) {
      FS.writeFile(filePath, file.data);
      FS.utime(
        filePath,
        dateToUnixTimestamp(file.modifyTime),
        dateToUnixTimestamp(file.modifyTime),
      );
    } else if (file.type == DIRTYPE) {
      FS.mkdir(filePath);
    }
  }
}

function readDirectory(FS: FS, path: string) {
  let files: TarFile[] = [];

  const traverseDirectory = (currentPath: string) => {
    const entries = FS.readdir(currentPath);
    entries.forEach((entry) => {
      if (entry === "." || entry === "..") {
        return;
      }
      const fullPath = currentPath + "/" + entry;
      const stats = FS.stat(fullPath);
      const data = FS.isFile(stats.mode)
        ? FS.readFile(fullPath, { encoding: "binary" })
        : new Uint8Array(0);
      files.push({
        name: fullPath.substring(path.length), // remove the root path
        mode: stats.mode,
        size: stats.size,
        type: FS.isFile(stats.mode) ? REGTYPE : DIRTYPE,
        modifyTime: stats.mtime,
        data,
      });
      if (FS.isDir(stats.mode)) {
        traverseDirectory(fullPath);
      }
    });
  };

  traverseDirectory(path);
  return files;
}

export function createTarball(FS: FS, directoryPath: string) {
  const files = readDirectory(FS, directoryPath);
  const tarball = tar(files);
  return tarball;
}

export async function maybeZip(
  file: Uint8Array,
): Promise<[Uint8Array, boolean]> {
  if (typeof window !== "undefined" && "CompressionStream" in window) {
    return [await zipBrowser(file), true];
  } else if (
    typeof process !== "undefined" &&
    process.versions &&
    process.versions.node
  ) {
    return [await zipNode(file), true];
  } else {
    return [file, false];
  }
}

export async function zipBrowser(file: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream("gzip");
  const writer = cs.writable.getWriter();
  const reader = cs.readable.getReader();

  writer.write(file);
  writer.close();

  const chunks: Uint8Array[] = [];

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }

  const compressed = new Uint8Array(
    chunks.reduce((acc, chunk) => acc + chunk.length, 0),
  );
  let offset = 0;
  chunks.forEach((chunk) => {
    compressed.set(chunk, offset);
    offset += chunk.length;
  });

  return compressed;
}

export async function zipNode(file: Uint8Array): Promise<Uint8Array> {
  const { promisify } = await import("util");
  const { gzip } = await import("zlib");
  const gzipPromise = promisify(gzip);
  return await gzipPromise(file);
}

export async function unzip(file: Uint8Array): Promise<Uint8Array> {
  if (typeof window !== "undefined" && "DecompressionStream" in window) {
    return await unzipBrowser(file);
  } else if (
    typeof process !== "undefined" &&
    process.versions &&
    process.versions.node
  ) {
    return await unzipNode(file);
  } else {
    throw new Error("Unsupported environment for decompression");
  }
}

export async function unzipBrowser(file: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("gzip");
  const writer = ds.writable.getWriter();
  const reader = ds.readable.getReader();

  writer.write(file);
  writer.close();

  const chunks: Uint8Array[] = [];

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }

  const decompressed = new Uint8Array(
    chunks.reduce((acc, chunk) => acc + chunk.length, 0),
  );
  let offset = 0;
  chunks.forEach((chunk) => {
    decompressed.set(chunk, offset);
    offset += chunk.length;
  });

  return decompressed;
}

export async function unzipNode(file: Uint8Array): Promise<Uint8Array> {
  const { promisify } = await import("util");
  const { gunzip } = await import("zlib");
  const gunzipPromise = promisify(gunzip);
  return await gunzipPromise(file);
}

function dateToUnixTimestamp(date: Date | number | undefined): number {
  if (!date) {
    return Math.floor(Date.now() / 1000);
  } else {
    return typeof date === "number" ? date : Math.floor(date.getTime() / 1000);
  }
}
