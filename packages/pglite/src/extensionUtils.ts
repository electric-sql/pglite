import { IN_NODE } from "./utils.js";

export async function loadExtensionBundle(bundlePath: URL): Promise<Blob> {
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
      })
    );
    return new Blob(chunks);
  } else {
    const response = await fetch(bundlePath.toString());
    if (!response.ok || !response.body) {
      throw new Error(
        `Failed to fetch extension bundle: ${response.statusText}`
      );
    }
    const decompressionStream = new DecompressionStream("gzip");
    const decompressedStream = new Response(
      response.body.pipeThrough(decompressionStream)
    );
    return decompressedStream.blob();
  }
}
