import * as fsExtra from "fs-extra";
import * as path from "path";
import * as glob from "glob";
import { promisify } from "util";
import { exec } from "child_process";

const findAndReplaceInFile = promisify(fsExtra.replaceFile);
const globPromise = promisify(glob);

const copyFile = (src, dest) => fsExtra.copyFile(src, dest);

const replaceInFile = (file, find, replace) =>
  findAndReplaceInFile(file, find, replace, "utf8");

const replaceInDir = async (dir, find, replace, extensions, recursive = false) => {
  const files = await globPromise(`${dir}/**/*.{${extensions.join(",")}}`, {
    nodir: true,
  });

  for (const file of files) {
    await replaceInFile(file, find, replace);
  }
};

const main = async () => {
  await Promise.all([
    copyFile("./release/postgres.wasm", "./dist/postgres.wasm"),
    copyFile("./release/share.data", "./dist/share.data"),
  ]);

  await replaceInDir("./dist", "new URL('../release/", "new URL('./", [".js"], true);
  await replaceInDir("./dist", "new URL(\"../release/", 'new URL("./', [".js"], true);
};

main()
  .then(() => console.log("Find and replace completed successfully"))
  .catch((err) => console.error(err));
