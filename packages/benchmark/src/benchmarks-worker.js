// Based on wa-sqlite's benchmarks
// Copyright 2021 Roy T. Hashimoto. All Rights Reserved.
// Modified by the PGLite authors.

import { PGlite } from './pglite/index.js'

;(async function () {
  const Comlink = await import('https://unpkg.com/comlink/dist/esm/comlink.mjs')

  /**
   * @param {Config} config
   * @returns {Promise<Function>}
   */
  async function open(config) {
    if (config.dataDir.startsWith('opfs-')) {
      // delete the existing database
      const root = await navigator.storage.getDirectory()
      const dirName = config.dataDir.slice(config.dataDir.indexOf('://') + 3)
      try {
        const dir = await root.getDirectoryHandle(dirName, { create: false })
        await dir.remove()
      } catch (e) {
        // ignore
      }
    }

    console.log('Opening PGLite database:', JSON.stringify(config, null, 2))
    const pg = new PGlite(config.dataDir, config.options)
    await pg.waitReady

    // Create the query interface.
    async function query(sql) {
      // console.log('Query:', sql);
      const startTime = performance.now()
      await pg.exec(sql)
      const elapsed = performance.now() - startTime
      return { elapsed }
    }
    return Comlink.proxy(query)
  }

  postMessage(null)
  Comlink.expose(open)
})()
