import { describe, it, expect } from 'vitest'
import { types } from '../dist/index.js'

describe('parse', () => {
  it('text', () => {
    expect(types.parseType('test', 0)).toEqual('test')
  })

  it('varchar 1043', () => {
    expect(types.parseType('test', 1043)).toEqual('test')
  })

  it('int2 21', () => {
    expect(types.parseType('1', 21)).toEqual(1)
  })

  it('int4 23', () => {
    expect(types.parseType('1', 23)).toEqual(1)
  })

  it('oid 26', () => {
    expect(types.parseType('1', 26)).toEqual(1)
  })

  it('float4 700', () => {
    expect(types.parseType('1.1', 700)).toEqual(1.1)
  })

  it('float8 701', () => {
    expect(types.parseType('1.1', 701)).toEqual(1.1)
  })

  it('int8 20', () => {
    expect(types.parseType('1', 20)).toEqual(1)
  })

  it('json 114', () => {
    expect(types.parseType('{"test":1}', 114)).toEqual({ test: 1 })
  })

  it('jsonb 3802', () => {
    expect(types.parseType('{"test":1}', 3802)).toEqual({ test: 1 })
  })

  it('bool 16', () => {
    expect(types.parseType('t', 16)).toEqual(true)
  })

  it('date 1082', () => {
    expect(types.parseType('2021-01-01', 1082)).toEqual(
      new Date('2021-01-01T00:00:00.000Z'),
    )
  })

  it('timestamp 1114', () => {
    // standardize timestamp comparison to UTC milliseconds to ensure predictable test runs on machines in different timezones.
    expect(
      types.parseType('2021-01-01T12:00:00', 1114).getUTCMilliseconds(),
    ).toEqual(new Date('2021-01-01T12:00:00.000Z').getUTCMilliseconds())
  })

  it('timestamptz 1184', () => {
    // standardize timestamp comparison to UTC milliseconds to ensure predictable test runs on machines in different timezones.
    expect(
      types.parseType('2021-01-01T12:00:00', 1184).getUTCMilliseconds(),
    ).toEqual(new Date('2021-01-01T12:00:00.000Z').getUTCMilliseconds())
  })

  it('bytea 17', () => {
    expect(types.parseType('\\x010203', 17)).toEqual(Uint8Array.from([1, 2, 3]))
  })

  it('unknown', () => {
    expect(types.parseType('test', 0)).toEqual('test')
  })
})

// Serialize type tests
describe('serialize', () => {
  it('string', () => {
    expect(types.serializeType('test')).toEqual(['test', 0])
  })

  it('string set all types', () => {
    expect(types.serializeType('test', true)).toEqual(['test', 25])
  })

  it('number', () => {
    expect(types.serializeType(1)).toEqual(['1', 0])
    expect(types.serializeType(1.1)).toEqual(['1.1', 0])
  })

  it('number set all types', () => {
    expect(types.serializeType(1, true)).toEqual(['1', 20])
    expect(types.serializeType(1.1, true)).toEqual(['1.1', 701])
  })

  it('bigint', () => {
    expect(types.serializeType(1n)).toEqual(['1', 20])
  })

  it('bool', () => {
    expect(types.serializeType(true)).toEqual(['t', 16])
  })

  it('date', () => {
    expect(types.serializeType(new Date('2021-01-01T00:00:00.000Z'))).toEqual([
      '2021-01-01T00:00:00.000Z',
      1184,
    ])
  })

  it('json', () => {
    expect(types.serializeType({ test: 1 })).toEqual(['{"test":1}', 114])
  })

  it('blob', () => {
    expect(types.serializeType(Uint8Array.from([1, 2, 3]))).toEqual([
      '\\x010203',
      17,
    ])
  })
})
