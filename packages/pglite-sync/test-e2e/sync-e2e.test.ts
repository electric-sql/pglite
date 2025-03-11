/// <reference types="node" />
import { describe, it, expect } from 'vitest'

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:54321/electric?sslmode=disable'
const ELECTRIC_URL = process.env.ELECTRIC_URL || 'http://localhost:3000/v1/shape'


describe('sync-e2e', () => {
  it('should sync data from postgres to pglite', async () => {
    console.log('DATABASE_URL', DATABASE_URL)
    console.log('ELECTRIC_URL', ELECTRIC_URL)
    // TODO: write tests!
  })
})

