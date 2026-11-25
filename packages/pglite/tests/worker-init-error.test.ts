import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { PGliteWorker, worker } from '../src/worker/index.js'

// Minimal in-memory stand-in for the Web Locks API, for runtimes without it.
// Locks are exclusive and held until the callback's promise settles.
function installWebLocks() {
  if ((globalThis.navigator as any)?.locks) return
  const queues = new Map<string, Promise<void>>()
  const locks = {
    request(name: string, callback: () => Promise<unknown>) {
      const previous = queues.get(name) ?? Promise.resolve()
      let release!: () => void
      const held = new Promise<void>((resolve) => (release = resolve))
      queues.set(
        name,
        previous.then(() => held),
      )
      return previous.then(async () => {
        try {
          return await callback()
        } finally {
          release()
        }
      })
    },
  }
  Object.defineProperty(globalThis.navigator, 'locks', {
    value: locks,
    configurable: true,
  })
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

let testId = 0

// Connects a `PGliteWorker` to `worker()` running in this same thread, by
// pointing the worker's global `postMessage`/`addEventListener` at the fake
// `Worker` handed to the client.
function connectWorker(init: () => Promise<any>) {
  const toWorker = new EventTarget()
  const toClient = new EventTarget()
  const g = globalThis as any
  g.postMessage = (data: unknown) =>
    toClient.dispatchEvent(new MessageEvent('message', { data }))
  g.addEventListener = (type: string, cb: any, options?: any) =>
    toWorker.addEventListener(type, cb, options)

  const fakeWorker = {
    postMessage: (data: unknown) =>
      toWorker.dispatchEvent(new MessageEvent('message', { data })),
    addEventListener: (type: string, cb: any, options?: any) =>
      toClient.addEventListener(type, cb, options),
    removeEventListener: (type: string, cb: any) =>
      toClient.removeEventListener(type, cb),
    terminate: () => {},
  } as unknown as Worker

  const id = `worker-init-error-${++testId}`
  const client = new PGliteWorker(fakeWorker, { id })
  const workerDone = worker({ init })
  return { id, client, workerDone }
}

describe('PGliteWorker when the worker init() rejects', () => {
  const cleanups: Array<() => void> = []

  beforeAll(installWebLocks)

  afterEach(() => {
    while (cleanups.length) cleanups.pop()!()
  })

  it('rejects waitReady with the original error instead of hanging', async () => {
    const { client } = connectWorker(async () => {
      throw new DOMException('boom', 'InvalidStateError')
    })
    cleanups.push(() => void client.close())

    await expect(client.waitReady).rejects.toMatchObject({
      name: 'InvalidStateError',
      message: 'boom',
    })

    // A later waitReady reports the same failure
    await expect(client.waitReady).rejects.toMatchObject({ message: 'boom' })
    expect(client.ready).toBe(false)
  })

  it('stops retrying and raises no unhandled rejections', async () => {
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => unhandled.push(reason)
    process.on('unhandledRejection', onUnhandled)
    cleanups.push(() => process.off('unhandledRejection', onUnhandled))

    const { id, client, workerDone } = connectWorker(async () => {
      throw new Error('init failed')
    })
    cleanups.push(() => void client.close())

    // Count the `tab-here` handshakes the client sends to the leader
    let tabHere = 0
    const spy = new BroadcastChannel(`pglite-broadcast:${id}`)
    spy.onmessage = (event) => {
      if (event.data.type === 'tab-here') tabHere++
    }
    cleanups.push(() => spy.close())

    await expect(client.waitReady).rejects.toThrow('init failed')

    // Let anything already in flight land, then check the retries have stopped
    await sleep(50)
    const settled = tabHere
    await sleep(150)
    expect(tabHere).toBe(settled)

    // The worker reports the failure to the client rather than rejecting itself
    await expect(workerDone).resolves.toBeUndefined()
    expect(unhandled).toEqual([])
  })
})
