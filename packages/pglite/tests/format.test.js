import { describe, beforeAll, it, expect } from 'vitest'
import { PGlite, formatQuery } from '../dist/index.js'

describe('format', () => {
  let pg
  beforeAll(async () => {
    pg = await PGlite.create()
  })

  it('boolean', async () => {
    const ret1 = await formatQuery(pg, 'SELECT * FROM test WHERE value = $1;', [
      true,
    ])
    expect(ret1).toBe("SELECT * FROM test WHERE value = 't';")
  })

  it('number', async () => {
    const ret2 = await formatQuery(pg, 'SELECT * FROM test WHERE value = $1;', [
      1,
    ])
    expect(ret2).toBe("SELECT * FROM test WHERE value = '1';")
  })

  it('string', async () => {
    const ret3 = await formatQuery(pg, 'SELECT * FROM test WHERE value = $1;', [
      'test',
    ])
    expect(ret3).toBe("SELECT * FROM test WHERE value = 'test';")
  })

  it('json', async () => {
    const ret4 = await formatQuery(pg, 'SELECT * FROM test WHERE value = $1;', [
      { test: 'test' },
    ])
    expect(ret4).toBe('SELECT * FROM test WHERE value = \'{"test":"test"}\';')
  })
})
