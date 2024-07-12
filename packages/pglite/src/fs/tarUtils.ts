import { tar, type TarFile } from "tinytar";
import { FS } from "../postgres.js";
import { PGDATA } from "./index.js";

export interface DumpTarResult {
  tarball: Uint8Array;
  extension: ".tar" | ".tgz";
}

export async function dumpTar(FS: FS): Promise<DumpTarResult> {
  const tarball = createTarball(FS, PGDATA);
  const [compressed, zipped] = await maybeZip(tarball);
  return {
    tarball: compressed,
    extension: zipped ? ".tgz" : ".tar",
  };
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
      if (FS.isDir(stats.mode)) {
        traverseDirectory(fullPath);
      } else if (FS.isFile(stats.mode)) {
        const data = FS.readFile(fullPath, { encoding: "binary" });
        files.push({
          name: fullPath.substring(path.length), // remove the root path
          mode: stats.mode,
          size: stats.size,
          modifyTime: stats.mtime,
          data: new Uint8Array(data),
        });
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
