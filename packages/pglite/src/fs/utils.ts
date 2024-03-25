import type { FS } from "../../release/postgres.js";

export function copyDir(fs: FS, src: string, dest: string) {
  const entries = fs.readdir(src);
  for (const name of entries) {
    if (name === "." || name === "..") continue;

    const srcPath = src + "/" + name;
    const destPath = dest + "/" + name;
    if (isDir(fs, srcPath)) {
      fs.mkdir(destPath);
      copyDir(fs, srcPath, destPath);
    } else {
      const data = fs.readFile(srcPath);
      fs.writeFile(destPath, data);
    }
  }
}

export function isDir(fs: FS, path: string) {
  return fs.isDir(fs.stat(path).mode);
}
