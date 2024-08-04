// Based on wa-sqlite's benchmarks
// Copyright 2021 Roy T. Hashimoto. All Rights Reserved.
// Modified by the PGLite authors.

// Define the selectable configurations.
const CONFIGURATIONS = new Map(
  [
    {
      label: "Memory",
      dataDir: "",
    },
    {
      label: "Memory (Unlogged Tables)",
      dataDir: "",
      modSql: (sql) => sql.replace(/CREATE TABLE/g, "CREATE UNLOGGED TABLE"),
    },
    {
      label: "Emscripten IndexedDB FS",
      dataDir: "idb://benchmark",
    },
    {
      label: "Emscripten IndexedDB FS<br> <i>relaxed durability</i>",
      dataDir: "idb://benchmark-rd",
      options: { relaxedDurability: true },
    },
    {
      label: "OPFS Access Handle Pool",
      dataDir: "opfs-ahp://benchmark-ahp",
    },
    {
      label: "OPFS Access Handle Pool<br> <i>relaxed durability</i>",
      dataDir: "opfs-ahp://benchmark-ahp-rd",
      options: { relaxedDurability: true },
    },
    // {
    //   label: "OPFS Worker",
    //   dataDir: "opfs-worker://benchmark-worker",
    // },
  ].map((obj) => [obj.label, obj])
);

const benchmarkIds = [
  "1",
  "2",
  "2.1",
  "3",
  "3.1",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "11",
  "12",
  "13",
  "14",
  "15",
  "16",
];

const benchmarksReady = Promise.all(
  benchmarkIds.map((id) => {
    const filename = `./benchmark${id}.sql`;
    return fetch(filename).then((response) => response.text());
  })
);

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
    const req = indexedDB.deleteDatabase("/pglite/benchmark");
    req.onsuccess = resolve;
    req.onerror = reject;
  });
  await new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase("/pglite/benchmark-rd");
    req.onsuccess = resolve;
    req.onerror = reject;
  });
  // OPFS
  const root = await navigator.storage.getDirectory();
  for await (const handle of root.values()) {
    if (handle.name.startsWith("benchmark")) {
      try {
        await root.removeEntry(handle.name, { recursive: true });
      } catch (e) {
        // ignore
      }
    }
  }

  // Clear timings from the table.
  Array.from(document.getElementsByTagName("tr"), (element) => {
    if (element.parentElement.tagName === "TBODY") {
      // Keep only the first child.
      while (element.firstElementChild.nextElementSibling) {
        element.firstElementChild.nextElementSibling.remove();
      }
    }
  });

  const benchmarks = await benchmarksReady;
  const Comlink = await ComlinkReady;
  try {
    // @ts-ignore
    const preamble = document.getElementById("preamble").value;
    document.getElementById("error").textContent = "";
    for (const config of CONFIGURATIONS.values()) {
      const worker = new Worker("./benchmarks-worker.js", { type: "module" });
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
        const query = await workerProxy({
          dataDir: config.dataDir,
          label: config.label,
          options: config.options,
        });

        await query(preamble);

        let tr = document.querySelector("tbody").firstElementChild;

        for (let b = 0; b < benchmarks.length; b++) {
          const benchmark = benchmarks[b];
          const sql = config.modSql ? config.modSql(benchmark) : benchmark;
          const { elapsed } = await query(sql);

          addEntry(tr, (elapsed / 1000).toFixed(3));
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
    throw e;
  } finally {
    // @ts-ignore
    event.target.disabled = false;
  }
});

function addEntry(parent, text) {
  const tag = parent.parentElement.tagName === "TBODY" ? "td" : "th";
  const child = document.createElement(tag);
  child.innerHTML = text;
  parent.appendChild(child);
}
