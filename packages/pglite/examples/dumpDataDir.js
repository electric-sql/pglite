import { PGlite } from "../dist/index.js";

const pg = new PGlite();
await pg.exec(`
  CREATE TABLE IF NOT EXISTS test (
    id SERIAL PRIMARY KEY,
    name TEXT
  );
`);
await pg.exec("INSERT INTO test (name) VALUES ('test');");

const { tarball, filename } = await pg.dumpDataDir();

if (typeof window !== 'undefined') {
  // Download the dump
  const blob = new Blob([tarball], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
} else {
  // Save the dump to a file using node fs
  const fs = await import("fs");
  fs.writeFileSync(filename, tarball);
}
