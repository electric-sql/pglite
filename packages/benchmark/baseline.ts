import SQLite from "better-sqlite3";
import EmbeddedPostgres from "embedded-postgres";
import fs from "fs";
import { AsciiTable3, AlignmentEnum } from "ascii-table3";

const benchmarks: string[] = [];
for (let i = 1; i <= 16; i++) {
  benchmarks.push(fs.readFileSync(`benchmark${i}.sql`, "utf8"));
}

interface Result {
  sqliteInMemory: number;
  sqliteOnDisk: number;
  postgres: number;
}

const results: Result[] = [];

for (let i = 0; i < benchmarks.length; i++) {
  const result: Result = {
    sqliteInMemory: 0,
    sqliteOnDisk: 0,
    postgres: 0,
  };
  results.push(result);
}

function runSQLite(fileName: string) {
  const inMemory = fileName === ":memory:";
  const resultsName = inMemory ? "sqliteInMemory" : "sqliteOnDisk";
  if (inMemory && fs.existsSync(fileName)) {
    fs.unlinkSync(fileName);
  }
  const db = new SQLite(fileName);

  console.log("SQLite", fileName);
  benchmarks.forEach((b, i) => {
    const startTime = Date.now();
    db.exec(b);
    const elapsed = (Date.now() - startTime) / 1000;
    console.log(`Test ${i}: ${elapsed}ms`);
    results[i][resultsName] = elapsed;
  });

  if (inMemory && fs.existsSync(fileName)) {
    fs.unlinkSync(fileName);
  }
}

async function runPostgres() {
  console.log("Postgres");

  const pg = new EmbeddedPostgres({
    data_dir: "./pgdata",
    user: "postgres",
    password: "password",
    port: 5439,
    persistent: false,
  });
  console.log(pg)
  await pg.initialise();
  await pg.start();
  const client = pg.getPgClient();
  await client.connect();

  for (const [i, b] of benchmarks.entries()) {
    const startTime = Date.now();
    await client.query(b);
    const elapsed = (Date.now() - startTime) / 1000;
    console.log(`Test ${i}: ${elapsed}ms`);
    results[i].postgres = elapsed;
  }

  await client.end();

  await pg.stop();
}

function resultsTable() {
  const table = new AsciiTable3("Benchmark Results");
  table.setHeading("Test", "SQLite In-Memory", "SQLite On-Disk", "Postgres");
  for (let i = 0; i < benchmarks.length; i++) {
    table.addRow(
      i + 1,
      results[i].sqliteInMemory,
      results[i].sqliteOnDisk,
      results[i].postgres
    );
  }
  table.setAlign(AlignmentEnum.Center);
  console.log(table.toString());
}

async function main() {
  runSQLite(":memory:");
  runSQLite("test-sqlite.db");
  await runPostgres();
  resultsTable();
}

main();