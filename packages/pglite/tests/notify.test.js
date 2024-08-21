import { describe, it, expect } from 'vitest'
import { PGlite } from '../dist/index.js'

describe('notify API', () => {
  it('notify', async () => {
    const db = new PGlite()

    await db.listen('test', (payload) => {
      expect(payload).toBe('321')
    })

    await db.query("NOTIFY test, '321'")

    await new Promise((resolve) => setTimeout(resolve, 1000))
  })

  it('unlisten', async () => {
    const db = new PGlite()

    const unsub = await db.listen('test', () => {
      throw new Error('Notification received after unsubscribed')
    })

    await unsub()

    await db.query('NOTIFY test')

    await new Promise((resolve) => setTimeout(resolve, 1000))
  })

  it('onNotification', async () => {
    const db = new PGlite()

    db.onNotification((chan, payload) => {
      expect(chan).toBe('test')
      expect(payload).toBe('123')
    })

    await db.query('LISTEN test')
    await db.query("NOTIFY test, '123'")

    await new Promise((resolve) => setTimeout(resolve, 1000))
  })
})
