import { describe, it, expect, afterEach } from 'vitest'
import { PGliteWorker } from '../dist/worker/index.js'

// `PGliteWorker` runs its leader handshake over `BroadcastChannel` and
// `navigator.locks`. Node supplies `BroadcastChannel`, so only the lock API and
// the worker itself need a stand-in. That keeps this test out of a browser.

type LockRelease = () => void

/**
 * A minimal `navigator.locks` that grants every request immediately. That is
 * correct here, because each lock id is unique to one instance.
 */
function installLockStub(): LockRelease {
  const locks = {
    request(_name: string, callback: () => Promise<unknown>) {
      return Promise.resolve().then(callback)
    },
  }
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  Object.defineProperty(globalThis, 'navigator', {
    value: { locks },
    configurable: true,
  })
  return () => {
    if (previous) {
      Object.defineProperty(globalThis, 'navigator', previous)
    } else {
      Reflect.deleteProperty(globalThis, 'navigator')
    }
  }
}

/** A stand-in for the leader `Worker`, driven by the test. */
class FakeWorker extends EventTarget {
  readonly posted: any[] = []
  terminated = false

  postMessage(data: any) {
    this.posted.push(data)
  }

  terminate() {
    this.terminated = true
  }

  /** Deliver a message from the worker to the main thread. */
  send(data: any) {
    this.dispatchEvent(new MessageEvent('message', { data }))
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor(condition: () => boolean) {
  for (let i = 0; i < 200 && !condition(); i++) {
    await sleep(5)
  }
  expect(condition()).toBe(true)
}

describe('PGliteWorker close', () => {
  const cleanups: Array<() => void> = []

  afterEach(() => {
    while (cleanups.length > 0) {
      cleanups.pop()!()
    }
  })

  it('stops the leader notify loop', async () => {
    cleanups.push(installLockStub())

    // Record each `tab-here` post made after `close()`. The loop re-arms every
    // 16ms while no leader has connected, so without a guard it posts to the
    // broadcast channel that `close()` has already closed. That post throws
    // `InvalidStateError`, and nothing handles it.
    const attemptsAfterClose: any[] = []
    let closed = false
    const originalPostMessage = BroadcastChannel.prototype.postMessage
    BroadcastChannel.prototype.postMessage = function (
      this: BroadcastChannel,
      data: any,
    ) {
      if (closed && data?.type === 'tab-here') {
        attemptsAfterClose.push(data)
      }
      originalPostMessage.call(this, data)
    }
    cleanups.push(() => {
      BroadcastChannel.prototype.postMessage = originalPostMessage
    })

    const workerId = `close-test-${crypto.randomUUID()}`
    const observer = new BroadcastChannel(`pglite-broadcast:${workerId}`)
    cleanups.push(() => observer.close())
    let announcements = 0
    observer.onmessage = (event: MessageEvent) => {
      if (event.data.type === 'tab-here') announcements++
    }

    const worker = new FakeWorker()
    const dbPromise = PGliteWorker.create(worker as unknown as Worker, {
      id: workerId,
    })
    worker.send({ type: 'here' })
    await waitFor(() => worker.posted.length > 0)
    worker.send({ type: 'ready', id: workerId })
    const db = await dbPromise

    // No leader ever connects, so the loop keeps announcing this tab.
    await waitFor(() => announcements > 1)

    closed = true
    await db.close()
    await sleep(100)

    expect(attemptsAfterClose).toEqual([])
  })
})
