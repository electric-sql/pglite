export const IN_NODE =
  typeof process === "object" &&
  typeof process.versions === "object" &&
  typeof process.versions.node === "string";

export async function makeLocateFile() {
  const PGWASM_URL = new URL("../release/postgres.wasm", import.meta.url);
  const PGSHARE_URL = new URL("../release/postgres.data", import.meta.url);
  const PGLIB_URL = new URL("../release/postgres.so", import.meta.url);
  let fileURLToPath = (fileUrl: URL) => fileUrl.pathname;
  if (IN_NODE) {
    fileURLToPath = (await import("url")).fileURLToPath;
  }
  return (base: string) => {
    let url: URL | null = null;
    switch (base) {
      case "postgres.data":
        url = PGSHARE_URL;
        break;
      case "postgres.wasm":
        url = PGWASM_URL;
        break;
      case "libecpg.so":
        url = PGLIB_URL;
        break;
      default:
        console.error("makeLocateFile", base);
    }

    if (url?.protocol === "file:") {
      return fileURLToPath(url);
    }
    return url?.toString() ?? "";
  };
}
