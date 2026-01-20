import { describe, it, expect } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { initdb } from '../dist/initdb.js'

describe('initdb', () => {
  it('should init a database', async () => {
    const pg = await PGlite.create()
    let result = await initdb({ pg, args: ["--no-clean"] })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).contains('You can now start the database server using')
  })
})
