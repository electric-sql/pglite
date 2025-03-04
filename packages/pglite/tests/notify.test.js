import { describe, it, expect, vi } from 'vitest'
import { PGlite } from '../dist/index.js'
import { expectToThrowAsync } from './test-utils.js'

describe('notify API', () => {
  it('notify', async () => {
    const db = new PGlite()

    await db.listen('test', (payload) => {
      expect(payload).toBe('321')
    })

    await db.exec("NOTIFY test, '321'")

    await new Promise((resolve) => setTimeout(resolve, 1000))
  })

  it('unlisten', async () => {
    const db = new PGlite()

    const unsub = await db.listen('test', () => {
      throw new Error('Notification received after unsubscribed')
    })

    await unsub()

    await db.exec('NOTIFY test')

    await new Promise((resolve) => setTimeout(resolve, 1000))
  })

  it('onNotification', async () => {
    const db = new PGlite()

    db.onNotification((chan, payload) => {
      expect(chan).toBe('test')
      expect(payload).toBe('123')
    })

    await db.exec('LISTEN test')
    await db.exec("NOTIFY test, '123'")

    await new Promise((resolve) => setTimeout(resolve, 1000))
  })

  it('check notify case sensitivity + special chars as Postgresql', async () => {
    const pg = new PGlite()

    const allLower1 = vi.fn()
    await pg.listen('postgresdefaultlower', allLower1)
    await pg.exec(`NOTIFY postgresdefaultlower, 'payload1'`)

    const autoLowerTest1 = vi.fn()
    await pg.listen('PostgresDefaultLower', autoLowerTest1)
    await pg.exec(`NOTIFY PostgresDefaultLower, 'payload1'`)

    const autoLowerTest2 = vi.fn()
    await pg.listen('PostgresDefaultLower', autoLowerTest2)
    await pg.exec(`NOTIFY postgresdefaultlower, 'payload1'`)

    const autoLowerTest3 = vi.fn()
    await pg.listen('postgresdefaultlower', autoLowerTest3)
    await pg.exec(`NOTIFY PostgresDefaultLower, 'payload1'`)

    const caseSensitive1 = vi.fn()
    await pg.listen('"tesT2"', caseSensitive1)
    await pg.exec(`NOTIFY "tesT2", 'paYloAd2'`)

    const caseSensitive2 = vi.fn()
    await pg.listen('"tesT3"', caseSensitive2)
    await pg.exec(`NOTIFY tesT3, 'paYloAd2'`)

    const caseSensitive3 = vi.fn()
    await pg.listen('testNotCalled2', caseSensitive3)
    await pg.exec(`NOTIFY "testNotCalled2", 'paYloAd2'`)

    const quotedWithSpaces = vi.fn()
    await pg.listen('"Quoted Channel With Spaces"', quotedWithSpaces)
    await pg.exec(`NOTIFY "Quoted Channel With Spaces", 'payload1'`)

    const unquotedWithSpaces = vi.fn()
    await expectToThrowAsync(
      pg.listen('Unquoted Channel With Spaces', unquotedWithSpaces),
    )
    await expectToThrowAsync(
      pg.exec(`NOTIFY Unquoted Channel With Spaces, 'payload1'`),
    )

    const otherCharsWithQuotes = vi.fn()
    await pg.listen('"test&me"', otherCharsWithQuotes)
    await pg.exec(`NOTIFY "test&me", 'paYloAd2'`)

    const otherChars = vi.fn()
    await expectToThrowAsync(pg.listen('test&me', otherChars))
    await expectToThrowAsync(pg.exec(`NOTIFY test&me, 'payload1'`))

    expect(allLower1).toHaveBeenCalledTimes(4)
    expect(autoLowerTest1).toHaveBeenCalledTimes(3)
    expect(autoLowerTest2).toHaveBeenCalledTimes(2)
    expect(autoLowerTest3).toHaveBeenCalledTimes(1)
    expect(caseSensitive1).toHaveBeenCalledOnce()
    expect(caseSensitive2).not.toHaveBeenCalled()
    expect(caseSensitive3).not.toHaveBeenCalled()
    expect(otherCharsWithQuotes).toHaveBeenCalledOnce()
    expect(quotedWithSpaces).toHaveBeenCalledOnce()
    expect(unquotedWithSpaces).not.toHaveBeenCalled()
  })

  it('check unlisten case sensitivity + special chars as Postgresql', async () => {
    const pg = new PGlite()

    const allLower1 = vi.fn()
    {
      const unsub1 = await pg.listen('postgresdefaultlower', allLower1)
      await pg.exec(`NOTIFY postgresdefaultlower, 'payload1'`)
      await unsub1()
    }

    const autoLowerTest1 = vi.fn()
    {
      const unsub2 = await pg.listen('PostgresDefaultLower', autoLowerTest1)
      await pg.exec(`NOTIFY PostgresDefaultLower, 'payload1'`)
      await unsub2()
    }

    const autoLowerTest2 = vi.fn()
    {
      const unsub3 = await pg.listen('PostgresDefaultLower', autoLowerTest2)
      await pg.exec(`NOTIFY postgresdefaultlower, 'payload1'`)
      await unsub3()
    }

    const autoLowerTest3 = vi.fn()
    {
      const unsub4 = await pg.listen('postgresdefaultlower', autoLowerTest3)
      await pg.exec(`NOTIFY PostgresDefaultLower, 'payload1'`)
      await unsub4()
    }

    const caseSensitive1 = vi.fn()
    {
      await pg.listen('"CaSESEnsiTIvE"', caseSensitive1)
      await pg.exec(`NOTIFY "CaSESEnsiTIvE", 'payload1'`)
      await pg.unlisten('"CaSESEnsiTIvE"')
      await pg.exec(`NOTIFY "CaSESEnsiTIvE", 'payload1'`)
    }

    const quotedWithSpaces = vi.fn()
    {
      await pg.listen('"Quoted Channel With Spaces"', quotedWithSpaces)
      await pg.exec(`NOTIFY "Quoted Channel With Spaces", 'payload1'`)
      await pg.unlisten('"Quoted Channel With Spaces"')
    }

    const otherCharsWithQuotes = vi.fn()
    {
      await pg.listen('"test&me"', otherCharsWithQuotes)
      await pg.exec(`NOTIFY "test&me", 'payload'`)
      await pg.unlisten('"test&me"')
    }

    expect(allLower1).toHaveBeenCalledOnce()
    expect(autoLowerTest1).toHaveBeenCalledOnce()
    expect(autoLowerTest2).toHaveBeenCalledOnce()
    expect(autoLowerTest3).toHaveBeenCalledOnce()
    expect(caseSensitive1).toHaveBeenCalledOnce()
    expect(otherCharsWithQuotes).toHaveBeenCalledOnce()
  })
})
