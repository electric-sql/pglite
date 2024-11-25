import * as fs from "fs/promises";
import * as path from "path";

const copyFiles = async (srcDir: string, destDir: string) => {
  await fs.mkdir(destDir, { recursive: true });
  const files = await fs.readdir(srcDir);
  for (const file of files) {
    if (file.startsWith(".")) {
      continue;
    }
    const srcFile = path.join(srcDir, file);
    const destFile = path.join(destDir, file);
    const stat = await fs.stat(srcFile);
    if (stat.isFile()) {
      await fs.copyFile(srcFile, destFile);
      console.log(`Copied ${srcFile} to ${destFile}`);
    }
  }
};

async function main() {
  await copyFiles("./release", "./dist");
}

main();
