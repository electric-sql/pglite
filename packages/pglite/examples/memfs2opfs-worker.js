import { PGlite } from '../dist/index.js'
import { worker } from '../dist/worker/index.js'
import { Memfs2OpfsFS } from '../dist/fs/memfs2opfs.js'

worker({
  async init() {
    // In a worker, MEMFS2OPFS flushes with sync access handles
    return new PGlite({
      fs: new Memfs2OpfsFS('memfs2opfs-worker-db', { debug: true }),
    })
  },
})

console.log('Worker process started')
