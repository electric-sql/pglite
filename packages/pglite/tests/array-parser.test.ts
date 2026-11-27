import { describe, expect, it } from 'vitest'
import { arrayParser } from '../src/types.js'

describe('arrayParser', () => {
  it('starts with clean state after an element parser throws', () => {
    const parseText = (value: string) => {
      if (value === 'first value') {
        throw new Error('rejected text value')
      }
      return value
    }
    const textArrayOid = 1009

    expect(() =>
      arrayParser('{"first value"}', parseText, textArrayOid),
    ).toThrow('rejected text value')
    expect(
      arrayParser('{"second value","third value"}', parseText, textArrayOid),
    ).toEqual(['second value', 'third value'])
  })
})
