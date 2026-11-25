import { describe, it, expect } from 'vitest'
import { PGliteWorker } from '../dist/worker/index.js'

// `PGliteWorker` forwards its options to the leader worker over `postMessage`.
// A real `Worker` structured-clones that message, and the structured clone
// algorithm cannot copy functions. These tests need no browser, only a
// stand-in worker that clones the same way.

/** A stand-in for the leader `Worker`, driven by the test. */
class FakeWorker extends EventTarget {
  readonly posted: any[] = []

  postMessage(data: any) {
    // Clone as a real `Worker` does, so a value that cannot cross the thread
    // boundary fails here too.
    this.posted.push(structuredClone(data))
  }

  terminate() {}

  /** Deliver a message from the worker to the main thread. */
  send(data: any) {
    this.dispatchEvent(new MessageEvent('message', { data }))
  }
}

const NUMERIC = 1700

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor(condition: () => boolean) {
  for (let i = 0; i < 200 && !condition(); i++) {
    await sleep(5)
  }
}

describe('PGliteWorker options', () => {
  it('sends the worker only options it can clone', async () => {
    const worker = new FakeWorker()
    const failures: unknown[] = []
    // `create` never resolves here, because the test stops after the `init`
    // message. Catch instead, so a rejection is an assertion and not noise.
    PGliteWorker.create(worker as unknown as Worker, {
      dataDir: 'memory://',
      serializers: { [NUMERIC]: (x: any) => x.toString() },
      parsers: { [NUMERIC]: (x: string) => BigInt(x) },
    }).catch((error) => failures.push(error))

    worker.send({ type: 'here' })
    await waitFor(() => worker.posted.length > 0 || failures.length > 0)

    expect(failures).toEqual([])
    expect(worker.posted).toHaveLength(1)
    const [message] = worker.posted
    expect(message.type).toBe('init')
    expect(message.options).not.toHaveProperty('parsers')
    expect(message.options).not.toHaveProperty('serializers')
    expect(message.options.dataDir).toBe('memory://')
  })

  it('applies parsers and serializers on this thread', () => {
    const serializer = (x: any) => x.toString()
    const parser = (x: string) => BigInt(x)
    const db = new PGliteWorker(new FakeWorker() as unknown as Worker, {
      dataDir: 'memory://',
      serializers: { [NUMERIC]: serializer },
      parsers: { [NUMERIC]: parser },
    })

    // `BasePGlite` serializes parameters and parses result rows here, not in
    // the leader worker, so these maps have to carry the overrides.
    expect(db.serializers[NUMERIC]).toBe(serializer)
    expect(db.parsers[NUMERIC]).toBe(parser)
  })
})
