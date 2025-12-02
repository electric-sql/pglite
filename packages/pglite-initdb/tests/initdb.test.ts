import { describe, it, expect } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { initdb } from '../dist/initdb.js'

describe('initdb', () => {
  it('should init a database', async () => {
    const pg = await PGlite.create('/tmp/1/')
    const result = await initdb({ pg })

    expect(result).toBeInstanceOf(0)
  })
})
