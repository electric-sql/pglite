// Based on wa-sqlite's benchmarks
// Copyright 2021 Roy T. Hashimoto. All Rights Reserved.
// Modified by the PGLite authors.

// Define the selectable configurations.
const CONFIGURATIONS = new Map(
  [
    {
      label: "PGlite Memory",
      db: "pglite",
      dataDir: "",
    },
    {
      label: "PGlite IDB",
      db: "pglite",
      dataDir: "idb://benchmark-rtt",
    },
    {
      label: "PGlite OPFS AHP",
      db: "pglite",
      dataDir: "opfs-ahp://benchmark-rtt",
    },
    {
      label: 'SQLite Memory',
      db: 'wa-sqlite',
      isAsync: false,
      vfsModule: './node_modules/wa-sqlite/src/examples/MemoryVFS.js',
      vfsClass: 'MemoryVFS',
      vfsArgs: []
    },
    {
      label: 'SQLite IDB',
      db: 'wa-sqlite',
      isAsync: true,
      vfsModule: './node_modules/wa-sqlite/src/examples/IDBMinimalVFS.js',
      vfsClass: 'IDBMinimalVFS',
      vfsArgs: ['demo-IDBMinimalVFS']
    },
    {
      label: 'SQLite OPFS',
      db: 'wa-sqlite',
      isAsync: true,
      vfsModule: './node_modules/wa-sqlite/src/examples/OriginPrivateFileSystemVFS.js',
      vfsClass: 'OriginPrivateFileSystemVFS',
      vfsArgs: []
    },
    {
      label: 'SQLite OPFS AHP',
      db: 'wa-sqlite',
      isAsync: false,
      vfsModule: './node_modules/wa-sqlite/src/examples/AccessHandlePoolVFS.js',
      vfsClass: 'AccessHandlePoolVFS',
      vfsArgs: ['/benchmark-rtt-sqlite-ahp']
    },
  ].map((obj) => [obj.label, obj])
);

const initalSetup = `
  CREATE TABLE t1 (id SERIAL PRIMARY KEY NOT NULL, a INTEGER);
  CREATE TABLE t2 (id SERIAL PRIMARY KEY NOT NULL, a TEXT);
`

const initalSetupSQLite = `
  CREATE TABLE t1 (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, a INTEGER);
  CREATE TABLE t2 (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, a TEXT);
`

const benchmarks = [
  `INSERT INTO t1 (a) VALUES (1);`,
  `SELECT * FROM t1 WHERE id = 333;`,
  `UPDATE t1 SET a = 2 WHERE id = 666;`,
  `DELETE FROM t1 WHERE id IN (SELECT id FROM t1 LIMIT 1);`,
  `INSERT INTO t2 (a) VALUES ('${"a".repeat(1000)}');`,
  `SELECT * FROM t2 WHERE id IN (SELECT id FROM t2 LIMIT 1);`,
  `UPDATE t2 SET a = '${"a".repeat(1000)}' WHERE id = 1;`,
  `DELETE FROM t2 WHERE id IN (SELECT id FROM t2 LIMIT 1);`,
  `INSERT INTO t2 (a) VALUES ('${"a".repeat(10000)}');`,
  `SELECT * FROM t2 WHERE id IN (SELECT id FROM t2 LIMIT 1);`,
  `UPDATE t2 SET a = '${"a".repeat(10000)}' WHERE id = 1;`,
  `DELETE FROM t2 WHERE id IN (SELECT id FROM t2 LIMIT 1);`,
]

const ITERATIONS = 100;

const ComlinkReady = import("https://unpkg.com/comlink/dist/esm/comlink.mjs");

const headers = document.querySelector("thead").firstElementChild;
for (const config of CONFIGURATIONS.values()) {
  addEntry(headers, config.label);
}

document.getElementById("start").addEventListener("click", async (event) => {
  // @ts-ignore
  event.target.disabled = true;

  // Clear any existing storage state.
  await new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase("/pglite/benchmark-rtt");
    req.onsuccess = resolve;
    req.onerror = reject;
  });

  // Clear any existing wa-sqlite state.
  await new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase("demo-IDBMinimalVFS");
    req.onsuccess = resolve;
    req.onerror = reject;
  });

  // Clear timings from the table.
  Array.from(document.getElementsByTagName("tr"), (element) => {
    if (element.parentElement.tagName === "TBODY") {
      // Keep only the first child.
      while (element.firstElementChild.nextElementSibling) {
        element.firstElementChild.nextElementSibling.remove();
      }
    }
  });

  // Remove OPFS
  const root = await navigator.storage.getDirectory();
  for await (const handle of root.values()) {
    try {
      await root.removeEntry(handle.name, { recursive: true });
    } catch (e) {
      // ignore
    }
  }

  const Comlink = await ComlinkReady;
  try {
    // @ts-ignore
    document.getElementById("error").textContent = "";
    for (const config of CONFIGURATIONS.values()) {
      const worker = new Worker("./rtt-demo-worker.js", { type: "module" });
      try {
        await Promise.race([
          new Promise((resolve) => {
            worker.addEventListener("message", resolve, { once: true });
          }),
          new Promise((_, reject) =>
            setTimeout(() => {
              reject(new Error(`${config.label} initialization timeout`));
            }, 5000)
          ),
        ]);

        const workerProxy = Comlink.wrap(worker);
        const query = await workerProxy(config);

        if (config.db === 'wa-sqlite') {
          await query(initalSetupSQLite);
        } else {
          await query(initalSetup);
        }

        let tr = document.querySelector("tbody").firstElementChild;

        for (let b = 0; b < benchmarks.length; b++) {
          const sql = benchmarks[b];
          let times = [];
          for (let i = 0; i < ITERATIONS; i++) {
            const { elapsed } = await query(sql);
            times.push(elapsed);
          }
          // sort the times array and remove the first and last 10% of the values
          times.sort((a, b) => a - b);
          times = times.slice(Math.floor(times.length * 0.1), Math.floor(times.length * 0.9));
          const avg = times.reduce((a, b) => a + b, 0) / times.length;
          addEntry(tr, avg.toFixed(3));
          tr = tr.nextElementSibling;
        }
      } finally {
        worker.terminate();
      }
    }
  } catch (e) {
    document.getElementById("error").textContent = e.stack.includes(e.message)
      ? e.stack
      : `${e.stack}\n${e.message}`;
  } finally {
    // @ts-ignore
    event.target.disabled = false;
  }
});

function addEntry(parent, text) {
  const tag = parent.parentElement.tagName === "TBODY" ? "td" : "th";
  const child = document.createElement(tag);
  child.textContent = text;
  parent.appendChild(child);
}
