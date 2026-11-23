import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { serialize } from '@electric-sql/pg-protocol'
import { PGlite } from '../dist/index.js'

function messageTypes(data: Uint8Array): string[] {
  const buffer = Buffer.from(data)
  const types: string[] = []
  for (let offset = 0; offset < buffer.length; ) {
    types.push(String.fromCharCode(buffer[offset]))
    offset += 1 + buffer.readInt32BE(offset + 1)
  }
  return types
}

const failures = [
  {
    stage: 'Parse',
    messages: () => [serialize.parse({ text: 'SELECT FROM' })],
    expected: ['E'],
  },
  {
    stage: 'Bind',
    messages: () => [
      serialize.parse({ text: 'SELECT $1::int' }),
      serialize.bind({ values: ['not-an-integer'] }),
    ],
    expected: ['1', 'E'],
  },
  {
    stage: 'Execute',
    messages: () => [
      serialize.parse({ text: 'INSERT INTO unique_values VALUES ($1)' }),
      serialize.bind({ values: ['1'] }),
      serialize.describe({ type: 'P' }),
      serialize.execute({}),
    ],
    expected: ['1', '2', 'n', 'E'],
  },
]

describe.each(['buffered', 'streamed'] as const)(
  '%s raw extended-query error recovery',
  (mode) => {
    let db: PGlite

    beforeEach(async () => {
      db = await PGlite.create()
      await db.exec(
        'CREATE TABLE unique_values (id int PRIMARY KEY); INSERT INTO unique_values VALUES (1)',
      )
    })

    afterEach(async () => {
      await db.close()
    })

    async function send(messages: Uint8Array[]): Promise<Uint8Array> {
      const input = Buffer.concat(
        messages.map((message) => Buffer.from(message)),
      )
      if (mode === 'buffered') return db.execProtocolRaw(input)
      const chunks: Buffer[] = []
      await db.execProtocolRawStream(input, {
        onRawData: (data) => chunks.push(Buffer.from(data)),
      })
      return Buffer.concat(chunks)
    }

    it.each(failures)(
      'waits for Sync after a $stage error, discarding intervening messages',
      async ({ messages, expected }) => {
        const received: string[] = []
        for (const message of messages()) {
          received.push(...messageTypes(await send([message])))
        }
        expect(received).toEqual(expected)
        expect(
          messageTypes(
            await send([
              serialize.parse({ text: 'SELECT 99' }),
              serialize.bind({}),
              serialize.execute({}),
              serialize.flush(),
            ]),
          ),
        ).toEqual([])
        const sync = await send([serialize.sync()])
        expect(messageTypes(sync)).toEqual(['Z'])
        expect(String.fromCharCode(sync[sync.length - 1])).toBe('I')
        expect((await db.query('SELECT $1::int AS value', [42])).rows).toEqual([
          { value: 42 },
        ])
      },
    )

    it.each(failures)(
      'sends exactly one ReadyForQuery for a batched $stage error',
      async ({ messages, expected }) => {
        expect(
          messageTypes(await send([...messages(), serialize.sync()])),
        ).toEqual([...expected, 'Z'])
      },
    )

    it('still sends one ReadyForQuery after each simple-query error', async () => {
      for (let cycle = 0; cycle < 3; cycle++) {
        expect(
          messageTypes(await send([serialize.query('SELECT FROM')])),
        ).toEqual(['E', 'Z'])
      }
    })

    it('reports failed transaction status at Sync and recovers with ROLLBACK', async () => {
      await send([serialize.query('BEGIN')])
      expect(messageTypes(await send(failures[2].messages()))).toEqual(
        failures[2].expected,
      )
      const sync = await send([serialize.sync()])
      expect(messageTypes(sync)).toEqual(['Z'])
      expect(String.fromCharCode(sync[sync.length - 1])).toBe('E')
      const rollback = await send([serialize.query('ROLLBACK')])
      expect(messageTypes(rollback)).toEqual(['C', 'Z'])
      expect(String.fromCharCode(rollback[rollback.length - 1])).toBe('I')
    })
  },
)
