// Based on wa-sqlite's benchmarks
// Copyright 2021 Roy T. Hashimoto. All Rights Reserved.
// Modified by the PGLite authors.

// Define the selectable configurations.
const CONFIGURATIONS = new Map([
  {
    label: 'Memory',
    dataDir: '',
  },
  {
    label: 'Emscripten IndexedDB FS',
    dataDir: 'idb://benchmark',
  },
].map(obj => [obj.label, obj]));

const benchmarksReady = Promise.all(Array.from(new Array(16), (_, i) => {
  const filename = `./benchmark${i + 1}.sql`;
  return fetch(filename).then(response => response.text());
}));
  
const ComlinkReady = import('https://unpkg.com/comlink/dist/esm/comlink.mjs');

const headers = document.querySelector('thead').firstElementChild;
for (const config of CONFIGURATIONS.values()) {
  addEntry(headers, config.label)
}

document.getElementById('start').addEventListener('click', async event => {
  // @ts-ignore
  event.target.disabled = true;

  // Clear any existing storage state.
  await new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase('/pglite/benchmark');
    req.onsuccess = resolve;
    req.onerror = reject;
  });

  // Clear timings from the table.
  Array.from(document.getElementsByTagName('tr'), element => {
    if (element.parentElement.tagName === 'TBODY') {
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
    const preamble = document.getElementById('preamble').value;
    document.getElementById('error').textContent = '';
    for (const config of CONFIGURATIONS.values()) {
      const worker = new Worker('./demo-worker.js', { type: 'module' });
      try {
        await Promise.race([
          new Promise(resolve => {
            worker.addEventListener('message', resolve, { once: true });
          }),
          new Promise((_, reject) => setTimeout(() => {
            reject(new Error(`${config.label} initialization timeout`));
          }, 5000))
        ])

        const workerProxy = Comlink.wrap(worker)
        const query = await workerProxy(config);

        await query(preamble);

        let tr = document.querySelector('tbody').firstElementChild;
        
        const skip = [];

        for (let b = 0; b < benchmarks.length; b++) {
          if (skip.includes(b + 1)) {
            addEntry(tr, 'SKIP');
            tr = tr.nextElementSibling;
            continue;
          }
          const benchmark = benchmarks[b];
          const startTime = Date.now();
          const lines = benchmark.split('\n');
          const chunkSize = Infinity;
          for (let i = 0; i < lines.length; i += chunkSize) {
            const sql = lines.slice(i, i + chunkSize).join('\n');
            const ret = await query(sql);
            // console.log(sql, ret);
          }
          const elapsed = (Date.now() - startTime) / 1000;

          addEntry(tr, elapsed.toString());
          tr = tr.nextElementSibling;
        }
      } finally {
        worker.terminate();
      }
    }
  } catch (e) {
    document.getElementById('error').textContent = e.stack.includes(e.message) ? e.stack : `${e.stack}\n${e.message}`;
  } finally {
    // @ts-ignore
    event.target.disabled = false;
  }
});

function addEntry(parent, text) {
  const tag = parent.parentElement.tagName === 'TBODY' ? 'td' : 'th';
  const child = document.createElement(tag);
  child.textContent = text;
  parent.appendChild(child);
}