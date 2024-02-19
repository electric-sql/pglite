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
