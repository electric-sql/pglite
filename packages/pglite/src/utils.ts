export const IN_NODE =
  typeof process === "object" &&
  typeof process.versions === "object" &&
  typeof process.versions.node === "string";

export async function nodeValues() {
  let dirname: string | undefined = undefined;
  let require: ((id: string) => any) | undefined = undefined;
  if (IN_NODE) {
    const module = await import("module");
    // In some environments importing 'module' doesn't have a 'default' property and
    // createRequire is on the top level of the import.
    // This is a workaround for that.
    // See https://github.com/electric-sql/pglite/issues/71
    const createRequire =
      module.default?.createRequire ??
      ((module as any)
        .createRequire as (typeof module.default)["createRequire"]);
    require = createRequire(import.meta.url);
    dirname = (await import("path")).dirname(import.meta.url);
  }
  return { dirname, require };
}

export async function makeLocateFile() {
  const PGWASM_URL = new URL("../release/postgres.wasm", import.meta.url);
  const PGSHARE_URL = new URL("../release/share.data", import.meta.url);
  let fileURLToPath = (fileUrl: URL) => fileUrl.pathname;
  if (IN_NODE) {
    fileURLToPath = (await import("url")).fileURLToPath;
  }
  return (base: string) => {
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
    return url?.toString() ?? "";
  };
}
