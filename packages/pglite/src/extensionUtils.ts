import tinyTar from "tinytar";
import { IN_NODE } from "./utils.js";
import type { PostgresMod } from "./postgresMod.js";

export async function loadExtensionBundle(
  bundlePath: URL,
): Promise<Blob | null> {
  // Async load the extension bundle tar file
  // could be from a URL or a file
  if (IN_NODE) {
    const fs = await import("fs");
    const zlib = await import("zlib");
    const { Writable } = await import("stream");
    const { pipeline } = await import("stream/promises");

    if (!fs.existsSync(bundlePath)) {
      throw new Error(`Extension bundle not found: ${bundlePath}`);
    }

    const gunzip = zlib.createGunzip();
    const chunks: Uint8Array[] = [];

    await pipeline(
      fs.createReadStream(bundlePath),
      gunzip,
      new Writable({
        write(chunk, encoding, callback) {
          chunks.push(chunk);
          callback();
        },
      }),
    );
    return new Blob(chunks);
  } else {
    const response = await fetch(bundlePath.toString());
    if (!response.ok || !response.body) {
      return null;
    } else if (response.headers.get("Content-Encoding") === "gzip") {
      // Although the bundle is manually compressed, some servers will recognize
      // that and add a content-encoding header. Fetch will then automatically
      // decompress the response.
      return response.blob();
    } else {
      const decompressionStream = new DecompressionStream("gzip");
      const decompressedStream = new Response(
        response.body.pipeThrough(decompressionStream),
      );
      return decompressedStream.blob();
    }
  }
}

export async function loadExtensions(
  mod: PostgresMod,
  log: (...args: any[]) => void,
) {
  for (const ext in mod.pg_extensions) {
    let blob;
    try {
      blob = await mod.pg_extensions[ext];
    } catch (err) {
      console.error("Failed to fetch extension:", ext, err);
      continue;
    }
    if (blob) {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      loadExtension(mod, ext, bytes, log);
    } else {
      console.error("Could not get binary data for extension:", ext);
    }
  }
}

function loadExtension(
  mod: PostgresMod,
  ext: string,
  bytes: Uint8Array,
  log: (...args: any[]) => void,
) {
  const data = tinyTar.untar(bytes);
  data.forEach((file) => {
    if (!file.name.startsWith(".")) {
      const filePath = mod.WASM_PREFIX + "/" + file.name;
      if (file.name.endsWith(".so")) {
        const extOk = (...args: any[]) => {
          log("pgfs:ext OK", filePath, args);
        };
        const extFail = (...args: any[]) => {
          log("pgfs:ext FAIL", filePath, args);
        };
        mod.FS.createPreloadedFile(
          dirname(filePath),
          file.name.split("/").pop()!.slice(0, -3),
          file.data as any, // There is a type error in Emscripten's FS.createPreloadedFile, this excepts a Uint8Array, but the type is defined as any
          true,
          true,
          extOk,
          extFail,
          false,
        );
      } else {
        mod.FS.writeFile(filePath, file.data);
      }
    }
  });
}

function dirname(path: string) {
  const last = path.lastIndexOf("/");
  if (last > 0) {
    return path.slice(0, last);
  } else {
    return path;
  }
}
