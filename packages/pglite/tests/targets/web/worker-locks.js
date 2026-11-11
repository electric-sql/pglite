import { PGlite } from '../../../dist/index.js'
import { worker } from '../../../dist/worker/index.js'

worker({
  async init() {
    // Expose the leader's database for deterministic lock-queue barriers.
    globalThis.pg = new PGlite()
    return globalThis.pg
  },
})
