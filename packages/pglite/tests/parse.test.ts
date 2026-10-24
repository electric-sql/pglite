import { describe, it, expect } from 'vitest'
import type { BackendMessage } from '@electric-sql/pg-protocol/messages'
import { parseResults } from '../src/parse'
import { parsers as defaultParsers, INT4, TEXT } from '../src/types'

// One result set with an INT4 and a TEXT column, as the backend sends it.
const messages = [
  {
    name: 'rowDescription',
    fields: [
      { name: 'n', dataTypeID: INT4 },
      { name: 's', dataTypeID: TEXT },
    ],
  },
  { name: 'dataRow', fields: ['42', 'hello'] },
  { name: 'commandComplete', text: 'SELECT 1' },
] as unknown as BackendMessage[]

describe('parseResults', () => {
  it('parses with the default parsers', () => {
    const [result] = parseResults(messages, defaultParsers)
    expect(result.rows).toEqual([{ n: 42, s: 'hello' }])
  })

  it('applies per-query parsers and keeps the defaults for other types', () => {
    const [result] = parseResults(messages, defaultParsers, {
      parsers: { [TEXT]: (x: string) => x.toUpperCase() },
    })
    expect(result.rows).toEqual([{ n: 42, s: 'HELLO' }])
  })

  it('does not change the default parsers', () => {
    const before = { ...defaultParsers }
    parseResults(messages, defaultParsers, {
      parsers: { [INT4]: (x: string) => `int:${x}` },
    })
    expect(defaultParsers).toEqual(before)
    const [result] = parseResults(messages, defaultParsers)
    expect(result.rows).toEqual([{ n: 42, s: 'hello' }])
  })
})
