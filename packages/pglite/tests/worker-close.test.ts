import { describe, it, expect } from 'vitest'
import { PGliteWorker } from '../src/worker/index.js'

class FakeWorker extends EventTarget {
  postMessage(message: { type: string }) {
    if (message.type === 'init') {
      setTimeout(() => this.#send({ type: 'ready', id: 'fake-worker' }))
    }
  }

  terminate() {}

  announce() {
    this.#send({ type: 'here' })
  }

  #send(data: unknown) {
    this.dispatchEvent(new MessageEvent('message', { data }))
  }
}

describe('PGliteWorker close', () => {
  it('stops looking for a leader once closed', async () => {
    const errors: unknown[] = []
    const onError = (error: unknown) => errors.push(error)
    process.on('unhandledRejection', onError)
    try {
      const worker = new FakeWorker()
      const pg = new PGliteWorker(worker as unknown as Worker)
      worker.announce()
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(pg.ready).toBe(false)
      await pg.close()
      await new Promise((resolve) => setTimeout(resolve, 100))
    } finally {
      process.off('unhandledRejection', onError)
    }
    expect(errors).toEqual([])
  })
})
