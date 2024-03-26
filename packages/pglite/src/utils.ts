import { fileURLToPath } from "url";

export const IN_NODE =
  typeof process === "object" &&
  typeof process.versions === "object" &&
  typeof process.versions.node === "string";

export async function nodeValues() {
  let dirname: string | undefined = undefined;
  let require: ((id: string) => any) | undefined = undefined;
  if (IN_NODE) {
    dirname = (await import("path")).dirname(import.meta.url);
    require = (await import("module")).default.createRequire(import.meta.url);
  }
  return { dirname, require };
}


const PGWASM_URL = new URL("../release/postgres.wasm", import.meta.url);
const PGSHARE_URL = new URL("../release/share.data", import.meta.url);
export function locatePostgresFile(base: string) {
  let url: URL | null = null;
  switch (base) {
    case "share.data":
      url = PGSHARE_URL;
      break;
    case "postgres.wasm":
      url = PGWASM_URL;
      break;
    default:
  }

  if (url?.protocol === "file:") {
    return fileURLToPath(url);
  }
  return url?.toString() ?? '';
}