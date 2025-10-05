// Based on wa-sqlite's benchmarks
// Copyright 2021 Roy T. Hashimoto. All Rights Reserved.
// Modified by the PGLite authors.

// Define the selectable configurations.
const CONFIGURATIONS = new Map(
  [
    {
      label: 'PGlite Memory<br> (CMA Transport <em>default</em>)',
      db: 'pglite',
      dataDir: '',
    },
    {
      label: 'PGlite Memory<br> (File Transport)',
      db: 'pglite',
      dataDir: '',
    },
    {
      label: 'PGlite IDB',
      db: 'pglite',
      dataDir: 'idb://benchmark-rtt',
    },
    {
      label: 'PGlite IDB (CMA) <br> <i>relaxed durability</i>',
      db: 'pglite',
      dataDir: 'idb://benchmark-rtt-rd',
      options: { relaxedDurability: true },
    },
    {
      label: 'PGlite OPFS AHP',
      db: 'pglite',
      dataDir: 'opfs-ahp://benchmark-rtt',
    },
    {
      label: 'PGlite OPFS AHP<br> <i>relaxed durability</i>',
      db: 'pglite',
      dataDir: 'opfs-ahp://benchmark-rtt-rd',
      options: { relaxedDurability: true },
    },
    {
      label: 'SQLite Memory',
      db: 'wa-sqlite',
      isAsync: false,
      vfsModule: './wa-sqlite/src/examples/MemoryVFS.js',
      vfsClass: 'MemoryVFS',
      vfsArgs: [],
    },
    {
      label: 'SQLite IDB',
      db: 'wa-sqlite',
      isAsync: true,
      vfsModule: './wa-sqlite/src/examples/IDBMinimalVFS.js',
      vfsClass: 'IDBMinimalVFS',
      vfsArgs: ['demo-IDBMinimalVFS'],
    },
    {
      label: 'SQLite IDB<br> <i>relaxed durability</i>',
      db: 'wa-sqlite',
      isAsync: true,
      vfsModule: './wa-sqlite/src/examples/IDBMinimalVFS.js',
      vfsClass: 'IDBMinimalVFS',
      vfsArgs: ['demo-IDBMinimalVFS-relaxed', { durability: 'relaxed' }],
    },
    {
      label: ' SQLite IDB BatchAtomic',
      db: 'wa-sqlite',
      isAsync: true,
      vfsModule: './wa-sqlite/src/examples/IDBBatchAtomicVFS.js',
      vfsClass: 'IDBBatchAtomicVFS',
      vfsArgs: ['demo-IDBBatchAtomicVFS'],
    },
    {
      label: 'SQLite IDB BatchAtomic<br> <i>relaxed durability</i>',
      db: 'wa-sqlite',
      isAsync: true,
      vfsModule: './wa-sqlite/src/examples/IDBBatchAtomicVFS.js',
      vfsClass: 'IDBBatchAtomicVFS',
      vfsArgs: ['demo-IDBBatchAtomicVFS-relaxed', { durability: 'relaxed' }],
    },
    {
      label: 'SQLite OPFS',
      db: 'wa-sqlite',
      isAsync: true,
      vfsModule: './wa-sqlite/src/examples/OriginPrivateFileSystemVFS.js',
      vfsClass: 'OriginPrivateFileSystemVFS',
      vfsArgs: [],
      dbName: 'benchmark-rtt-sqlite',
    },
    {
      label: 'SQLite OPFS AHP',
      db: 'wa-sqlite',
      isAsync: false,
      vfsModule: './wa-sqlite/src/examples/AccessHandlePoolVFS.js',
      vfsClass: 'AccessHandlePoolVFS',
      vfsArgs: ['/benchmark-rtt-sqlite-ahp'],
    },
  ].map((obj) => [obj.label, obj]),
)

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
  `INSERT INTO t2 (a) VALUES ('${'a'.repeat(1000)}');`,
  `SELECT * FROM t2 WHERE id IN (SELECT id FROM t2 LIMIT 1);`,
  `UPDATE t2 SET a = '${'a'.repeat(1000)}' WHERE id = 1;`,
  `DELETE FROM t2 WHERE id IN (SELECT id FROM t2 LIMIT 1);`,
  `INSERT INTO t2 (a) VALUES ('${'a'.repeat(10000)}');`,
  `SELECT * FROM t2 WHERE id IN (SELECT id FROM t2 LIMIT 1);`,
  `UPDATE t2 SET a = '${'a'.repeat(10000)}' WHERE id = 1;`,
  `DELETE FROM t2 WHERE id IN (SELECT id FROM t2 LIMIT 1);`,
]

const ITERATIONS = 100

const ComlinkReady = import('https://unpkg.com/comlink/dist/esm/comlink.mjs')

const headers = document.querySelector('thead').firstElementChild
for (const config of CONFIGURATIONS.values()) {
  addEntry(headers, config.label)
}

document.getElementById('start').addEventListener('click', async (event) => {
  event.target.disabled = true

  // Clear any existing storage state.
  for (const name of [
    '/pglite/benchmark-rtt',
    '/pglite/benchmark-rtt-rd',
    'demo-IDBMinimalVFS',
    'demo-IDBMinimalVFS-relaxed',
    'demo-IDBBatchAtomicVFS',
    'demo-IDBBatchAtomicVFS-relaxed',
  ]) {
    await new Promise((resolve, reject) => {
      const req = indexedDB.deleteDatabase(name)
      req.onsuccess = resolve
      req.onerror = reject
    })
  }
  // OPFS
  const root = await navigator.storage.getDirectory()
  for await (const handle of root.values()) {
    if (handle.name.startsWith('benchmark')) {
      try {
        await root.removeEntry(handle.name, { recursive: true })
      } catch (e) {
        // ignore
      }
    }
  }

  // Clear timings from the table.
  Array.from(document.getElementsByTagName('tr'), (element) => {
    if (element.parentElement.tagName === 'TBODY') {
      // Keep only the first child.
      while (element.firstElementChild.nextElementSibling) {
        element.firstElementChild.nextElementSibling.remove()
      }
    }
  })

  const Comlink = await ComlinkReady
  try {
    document.getElementById('error').textContent = ''
    for (const config of CONFIGURATIONS.values()) {
      const worker = new Worker('./rtt-worker.js', { type: 'module' })
      try {
        await Promise.race([
          new Promise((resolve) => {
            worker.addEventListener('message', resolve, { once: true })
          }),
          new Promise((_, reject) =>
            setTimeout(() => {
              reject(new Error(`${config.label} initialization timeout`))
            }, 5000),
          ),
        ])

        const workerProxy = Comlink.wrap(worker)
        const query = await workerProxy(config)

        if (config.db === 'wa-sqlite') {
          await query(initalSetupSQLite)
        } else {
          await query(initalSetup)
        }

        let tr = document.querySelector('tbody').firstElementChild

        for (let b = 0; b < benchmarks.length; b++) {
          const sql = benchmarks[b]
          let times = []
          for (let i = 0; i < ITERATIONS; i++) {
            const { elapsed } = await query(sql)
            times.push(elapsed)
          }
          // sort the times array and remove the first and last 10% of the values
          times.sort((a, b) => a - b)
          times = times.slice(
            Math.floor(times.length * 0.1),
            Math.floor(times.length * 0.9),
          )
          const avg = times.reduce((a, b) => a + b, 0) / times.length
          addEntry(tr, avg.toFixed(3))
          tr = tr.nextElementSibling
        }
      } finally {
        worker.terminate()
      }
    }
  } catch (e) {
    document.getElementById('error').textContent = e.stack.includes(e.message)
      ? e.stack
      : `${e.stack}\n${e.message}`
  } finally {
    event.target.disabled = false
  }
})

function addEntry(parent, text) {
  const tag = parent.parentElement.tagName === 'TBODY' ? 'td' : 'th'
  const child = document.createElement(tag)
  child.innerHTML = text
  parent.appendChild(child)
}
