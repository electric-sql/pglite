import * as fs from "fs/promises";
import * as path from "path";

async function findAndReplaceInFile(
  find: string | RegExp,
  replace: string,
  file: string
): Promise<void> {
  const content = await fs.readFile(file, "utf8");
  const replacedContent = content.replace(find, replace);
  await fs.writeFile(file, replacedContent);
}

async function findAndReplaceInDir(
  dir: string,
  find: string | RegExp,
  replace: string,
  extensions: string[],
  recursive = false
): Promise<void> {
  const files = await fs.readdir(dir, { withFileTypes: true });

  for (const file of files) {
    const filePath = path.join(dir, file.name);
    if (file.isDirectory() && recursive) {
      await findAndReplaceInDir(filePath, find, replace, extensions);
    } else {
      const fileExt = path.extname(file.name);
      if (extensions.includes(fileExt)) {
        await findAndReplaceInFile(find, replace, filePath);
      }
    }
  }
}

async function main() {
  await fs.copyFile("./release/postgres.wasm", "./dist/postgres.wasm");
  await fs.copyFile("./release/postgres.data", "./dist/postgres.data");
  await fs.copyFile("./release/postgres.js", "./dist/postgres.js");
  await fs.copyFile("./release/vector.tar.gz", "./dist/vector.tar.gz");
  await findAndReplaceInDir(
    "./dist",
    /new URL\('\.\.\/release\//g,
    "new URL('./",
    [".js"]
  );
  await findAndReplaceInDir(
    "./dist",
    /new URL\("\.\.\/release\//g,
    'new URL("./',
    [".js"]
  );
  await findAndReplaceInDir(
    "./dist/vector",
    /new URL\("\.\.\/\.\.\/release\//g,
    'new URL("\.\.\/',
    [".js"]
  );
}

await main();
