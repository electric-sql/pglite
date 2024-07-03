import { FS } from "../release/postgres";
import { Extension } from "./interface";

export const IN_NODE =
  typeof process === "object" &&
  typeof process.versions === "object" &&
  typeof process.versions.node === "string";

export function isValidUrl(urlString: string): boolean {
  try {
    return Boolean(new URL(urlString));
  } catch (_) {
    return false;
  }
}

export function getExtensionVersionFromControlFile(controlFileContent: string): string {
  const matches = controlFileContent.match(/default_version = '(.*)'/);
  return matches ? matches[1] : '';
}

export function fileExists(fs: FS, path: string): boolean {
  try {
    fs.stat(path);
    return true;
  } catch (_) {
    return false;
  }
}

export async function getExtensionControlFile(extension: Extension, extName: string) {
  let controlFileContent = '';
  const controlFilePath = `${extension.pathOrUrl}/${extName}.control`;
  try {
    if (isValidUrl(extension.pathOrUrl || '')) {
      controlFileContent = await (await fetch(controlFilePath)).text();
    } else if (IN_NODE) {
      const fs = await import('fs');
      controlFileContent = fs.readFileSync(controlFilePath).toString();
    } else {
      throw new Error('Extensions from filesystem can only be used in Node environment. Please provide URL if you are running in browser environment');
    }
  } catch (err) {
    throw new Error(`Error happened while trying to read control file for extension ${extName}: ${err}`);
  }

  return controlFileContent;
}

export async function getExtensionSqlScript(extension: Extension, extName: string, sqlFilePath: string) {
  let sqlFileContent = '';
  try {
    if (isValidUrl(extension.pathOrUrl || '')) {
      sqlFileContent = await (await fetch(sqlFilePath)).text();
    } else if (IN_NODE) {
      const fs = await import('fs');
      sqlFileContent = fs.readFileSync(sqlFilePath).toString();
    } else {
      throw new Error('Extensions from filesystem can only be used in Node environment. Please provide URL if you are running in browser environment');
    }
  } catch (err) {
    throw new Error(`Error happened while trying to read sql file for extension ${extName}: ${err}`);
  }

  return sqlFileContent;
}

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

    if (base.match(/^https?:\//)) {
      // The url is being sanitized "Path.normalize" from dlopeninternal and // is replaced with /
      return base.replace(':/', '://');
    }

    return url?.toString() ?? base;
  };
}
