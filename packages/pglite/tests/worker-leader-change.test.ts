import { describe, it, expect } from 'vitest'
import { PGliteWorker } from '../src/worker/index.js'

// Stands in for the worker side of the multi-tab protocol: it reports that
// it is here and ready, then a leader is elected: this tab's own worker, or
// the worker of another tab
class FakeLeaderWorker extends EventTarget {
  #ownLeader: boolean
  #channel?: BroadcastChannel
  #tabChannel?: BroadcastChannel

  constructor(ownLeader: boolean) {
    super()
    this.#ownLeader = ownLeader
    setTimeout(() => this.#send({ type: 'here' }))
  }

  postMessage(msg: any) {
    if (msg.type !== 'init') return
    const id = 'leader-change-test'
    this.#send({ type: 'ready', id })
    setTimeout(() => {
      this.#channel = new BroadcastChannel(`pglite-broadcast:${id}`)
      this.#channel.onmessage = (event) => {
        if (event.data.type !== 'tab-here' || this.#tabChannel) return
        this.#tabChannel = new BroadcastChannel(`pglite-tab:${event.data.id}`)
        this.#tabChannel.postMessage({ type: 'connected' })
      }
      const tabId = this.#ownLeader ? msg.tabId : 'another-tab'
      this.#channel.postMessage({ type: 'leader-here', id, tabId })
      if (this.#ownLeader) this.#send({ type: 'leader-now' })
    }, 10)
  }

  terminate() {
    this.#channel?.close()
    this.#tabChannel?.close()
  }

  #send(data: any) {
    this.dispatchEvent(new MessageEvent('message', { data }))
  }
}

describe('PGliteWorker leader change', () => {
  it('fires leader-change once when this tab becomes the leader', async () => {
    const pg = new PGliteWorker(new FakeLeaderWorker(true) as unknown as Worker)
    let changes = 0
    pg.onLeaderChange(() => changes++)

    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(pg.isLeader).toBe(true)
    expect(changes).toBe(1)
    await pg.close()
  })

  it('fires leader-change when another tab becomes the leader', async () => {
    const pg = new PGliteWorker(
      new FakeLeaderWorker(false) as unknown as Worker,
    )
    let changes = 0
    pg.onLeaderChange(() => changes++)

    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(pg.isLeader).toBe(false)
    expect(changes).toBe(1)
    await pg.close()
  })
})
