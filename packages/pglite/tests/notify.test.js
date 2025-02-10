import { describe, it, expect, vi } from 'vitest'
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

  it('check case sensitivity as Postgresql', async () => {
    const pg = new PGlite(undefined, { debug: 5 })

    const allLower1 = vi.fn()
    await pg.listen('alllower1', allLower1)
    await pg.query(`NOTIFY alllower1, 'payload1'`)
    expect(allLower1).toHaveBeenCalledOnce()

    const autoLowerTest1 = vi.fn()
    await pg.listen('PostgresDefaultLower', autoLowerTest1)
    await pg.query(`NOTIFY PostgresDefaultLower, 'payload1'`)
    expect(autoLowerTest1).toHaveBeenCalledOnce()

    const autoLowerTest2 = vi.fn()
    await pg.listen('PosgresDefaultLower', autoLowerTest2)
    await pg.query(`NOTIFY posgresdefaultlower, 'payload1'`)
    expect(autoLowerTest2).toHaveBeenCalledOnce()

    const autoLowerTest3 = vi.fn()
    await pg.listen('posgresdefaultlower', autoLowerTest3)
    await pg.query(`NOTIFY PosgresDefaultLower, 'payload1'`)
    expect(autoLowerTest3).toHaveBeenCalledOnce()

    const caseSensitive1 = vi.fn()
    await pg.listen('"tesT2"', caseSensitive1)
    await pg.query(`NOTIFY "tesT2", 'paYloAd2'`)
    expect(caseSensitive1).toHaveBeenCalledOnce()

    const caseSensitive2 = vi.fn()
    await pg.listen('"testNotCalled1"', caseSensitive2)
    await pg.query(`NOTIFY testNotCalled1, 'paYloAd2'`)
    expect(caseSensitive2).not.toHaveBeenCalled()

    const caseSensitive3 = vi.fn()
    await pg.listen('testNotCalled2', caseSensitive3)
    await pg.query(`NOTIFY "testNotCalled2", 'paYloAd2'`)
    expect(caseSensitive3).not.toHaveBeenCalled()
  })
})
