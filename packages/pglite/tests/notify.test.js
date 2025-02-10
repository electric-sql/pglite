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

  it('check notify case sensitivity as Postgresql', async () => {
    const pg = new PGlite()

    const allLower1 = vi.fn()
    await pg.listen('postgresdefaultlower', allLower1)
    await pg.query(`NOTIFY postgresdefaultlower, 'payload1'`)

    const autoLowerTest1 = vi.fn()
    await pg.listen('PostgresDefaultLower', autoLowerTest1)
    await pg.query(`NOTIFY PostgresDefaultLower, 'payload1'`)

    const autoLowerTest2 = vi.fn()
    await pg.listen('PostgresDefaultLower', autoLowerTest2)
    await pg.query(`NOTIFY postgresdefaultlower, 'payload1'`)

    const autoLowerTest3 = vi.fn()
    await pg.listen('postgresdefaultlower', autoLowerTest3)
    await pg.query(`NOTIFY PostgresDefaultLower, 'payload1'`)

    const caseSensitive1 = vi.fn()
    await pg.listen('"tesT2"', caseSensitive1)
    await pg.query(`NOTIFY "tesT2", 'paYloAd2'`)

    const caseSensitive2 = vi.fn()
    await pg.listen('"tesT3"', caseSensitive2)
    await pg.query(`NOTIFY tesT3, 'paYloAd2'`)

    const caseSensitive3 = vi.fn()
    await pg.listen('testNotCalled2', caseSensitive3)
    await pg.query(`NOTIFY "testNotCalled2", 'paYloAd2'`)

    expect(allLower1).toHaveBeenCalledTimes(4)
    expect(autoLowerTest1).toHaveBeenCalledTimes(3)
    expect(autoLowerTest2).toHaveBeenCalledTimes(2)
    expect(autoLowerTest3).toHaveBeenCalledTimes(1)
    expect(caseSensitive1).toHaveBeenCalledOnce()
    expect(caseSensitive2).not.toHaveBeenCalled()
    expect(caseSensitive3).not.toHaveBeenCalled()
  })

  it('check unlisten case sensitivity as Postgresql', async () => {
    const pg = new PGlite()

    const allLower1 = vi.fn()
    {
      const unsub1 = await pg.listen('postgresdefaultlower', allLower1)
      await pg.query(`NOTIFY postgresdefaultlower, 'payload1'`)
      await unsub1()
    }

    const autoLowerTest1 = vi.fn()
    {
      const unsub2 = await pg.listen('PostgresDefaultLower', autoLowerTest1)
      await pg.query(`NOTIFY PostgresDefaultLower, 'payload1'`)
      await unsub2()
    }

    const autoLowerTest2 = vi.fn()
    {
      const unsub3 = await pg.listen('PostgresDefaultLower', autoLowerTest2)
      await pg.query(`NOTIFY postgresdefaultlower, 'payload1'`)
      await unsub3()
    }

    const autoLowerTest3 = vi.fn()
    {
      const unsub4 = await pg.listen('postgresdefaultlower', autoLowerTest3)
      await pg.query(`NOTIFY PostgresDefaultLower, 'payload1'`)
      await unsub4()
    }

    const caseSensitive1 = vi.fn()
    {
      await pg.listen('"CaSESEnsiTIvE"', caseSensitive1)
      await pg.query(`NOTIFY "CaSESEnsiTIvE", 'payload1'`)
      await pg.unlisten('CaSESEnsiTIvE')
      await pg.query(`NOTIFY "CaSESEnsiTIvE", 'payload1'`)
    }

    expect(allLower1).toHaveBeenCalledOnce()
    expect(autoLowerTest1).toHaveBeenCalledOnce()
    expect(autoLowerTest2).toHaveBeenCalledOnce()
    expect(autoLowerTest3).toHaveBeenCalledOnce()
    expect(caseSensitive1).toHaveBeenCalledOnce()
  })
})
