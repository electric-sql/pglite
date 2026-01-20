import { describe, it, expect } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { initdb } from '../dist/initdb.js'

describe('initdb', () => {
  it('should init a database', async () => {
    // const pg = await PGlite.create('/home/tdr/Desktop/electric/newpglite/fs0/beforesingle')
    const pg = await PGlite.create()
    let result = -1
    try {
      result = await initdb({ pg, args: ["--no-clean"] })

    } catch {
      console.log("Caught error")
    }

    expect(result).toBe(0)
  })
})
