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
  // pg_dump is not yet available from CI, so we download as precompiled 
  try {
    await fs.access("./release");
  } catch {
    await fs.mkdir("./release", { recursive: true });
  }

  try {
    await fs.access("./release/pg_dump.wasm");
    console.log("pg_dump.wasm already exists in release directory");
  } catch {
    console.log("Downloading pg_dump.wasm to release directory ...");
    const response = await fetch("https://static.pglite.dev/pg_tools/pg_dump_2025-07-14.wasm");
    const wasmBuffer = await response.arrayBuffer();
    
    await fs.writeFile("./release/pg_dump.wasm", new Uint8Array(wasmBuffer));
    console.log("Success downloading pg_dump.wasm to release directory");
  }
  
  await copyFiles("./release", "./dist");
}

main();
