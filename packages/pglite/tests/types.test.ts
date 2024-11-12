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
    expect(types.serializers[25]('test')).toEqual('test')
  })

  it('string from number', () => {
    expect(types.serializers[25](1)).toEqual('1')
  })

  it('not string', () => {
    expect(() => types.serializers[25](true)).toThrow()
  })

  it('number', () => {
    expect(types.serializers[0](1)).toEqual('1')
    expect(types.serializers[0](1.1)).toEqual('1.1')
  })

  it('bigint', () => {
    expect(types.serializers[20](1n)).toEqual('1')
  })

  it('bool', () => {
    expect(types.serializers[16](true)).toEqual('t')
  })

  it('not bool', () => {
    expect(() => types.serializers[16]('test')).toThrow()
  })

  it('date', () => {
    expect(
      types.serializers[1184](new Date('2021-01-01T00:00:00.000Z')),
    ).toEqual('2021-01-01T00:00:00.000Z')
  })

  it('date from number', () => {
    expect(types.serializers[1184](1672531200000)).toEqual(
      '2023-01-01T00:00:00.000Z',
    )
  })

  it('date from string', () => {
    expect(types.serializers[1184]('2021-01-01T00:00:00.000Z')).toEqual(
      '2021-01-01T00:00:00.000Z',
    )
  })

  it('not date', () => {
    expect(() => types.serializers[1184](true)).toThrow()
  })

  it('json', () => {
    expect(types.serializers[114]({ test: 1 })).toEqual('{"test":1}')
  })

  it('json from string', () => {
    expect(types.serializers[114](JSON.stringify({ test: 1 }))).toEqual(
      '{"test":1}',
    )
  })

  it('blob', () => {
    expect(types.serializers[17](Uint8Array.from([1, 2, 3]))).toEqual(
      '\\x010203',
    )
  })

  it('not blob', () => {
    expect(() => types.serializers[17](1)).toThrow()
  })
})
