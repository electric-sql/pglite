import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PGlite } from '../dist/index.js'
import { serialize } from '@electric-sql/pg-protocol'
import { testDTC } from './test-utils.js'

testDTC(async (defaultDataTransferContainer) => {
  describe('exec protocol', () => {
    let db: PGlite

    beforeAll(async () => {
      db = await PGlite.create({
        defaultDataTransferContainer,
      })
    })

    afterAll(async () => {
      await db.close()
    })

    it('should perform a simple query', async () => {
      const result = await db.execProtocol(serialize.query('SELECT 1'))
      const messageNames = result.messages.map((msg) => msg.name)
      expect(messageNames).toEqual([
        'rowDescription',
        'dataRow',
        'commandComplete',
        'readyForQuery',
      ])
    })

    it('should perform an extended query', async () => {
      const r1 = await db.execProtocol(serialize.parse({ text: 'SELECT $1' }))
      const messageNames1 = r1.messages.map((msg) => msg.name)
      expect(messageNames1).toEqual([
        'notice',
        'parseComplete',
        'readyForQuery',
      ])

      const r2 = await db.execProtocol(serialize.bind({ values: ['1'] }))
      const messageNames2 = r2.messages.map((msg) => msg.name)
      expect(messageNames2).toEqual(['notice', 'bindComplete', 'readyForQuery'])

      const r3 = await db.execProtocol(serialize.describe({ type: 'P' }))
      const messageNames3 = r3.messages.map((msg) => msg.name)
      expect(messageNames3).toEqual(['rowDescription', 'readyForQuery'])

      const r4 = await db.execProtocol(serialize.execute({}))
      const messageNames4 = r4.messages.map((msg) => msg.name)
      expect(messageNames4).toEqual([
        'dataRow',
        'commandComplete',
        'readyForQuery',
      ])

      const r5 = await db.execProtocol(serialize.sync())
      const messageNames5 = r5.messages.map((msg) => msg.name)
      expect(messageNames5).toEqual(['readyForQuery'])
    })

    it('should handle error', async () => {
      const result = await db.execProtocol(serialize.query('invalid sql'), {
        throwOnError: false,
      })
      const messageNames = result.messages.map((msg) => msg.name)
      expect(messageNames).toEqual(['error', 'readyForQuery'])
    })

    it('should throw error', async () => {
      await expect(
        db.execProtocol(serialize.query('invalid sql')),
      ).rejects.toThrow()
    })
  })
})
