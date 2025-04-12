import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import postgres from 'postgres'
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '../src'

describe('PGLite Socket Server with postgres client', () => {
  let db: PGlite
  let server: PGLiteSocketServer
  const TEST_PORT = 5432

  beforeAll(async () => {
    // Create a PGlite instance
    db = await PGlite.create()

    // Wait for database to be ready
    await db.waitReady

    console.log('PGLite database ready')

    // Create and start the server with explicit host
    server = new PGLiteSocketServer({
      db,
      port: TEST_PORT,
      host: '127.0.0.1',
    })

    // Add event listeners for debugging
    server.addEventListener('error', (event) => {
      console.error('Socket server error:', (event as CustomEvent).detail)
    })

    server.addEventListener('connection', (event) => {
      console.log('Socket connection received:', (event as CustomEvent).detail)
    })

    await server.start()
    console.log(`PGLite Socket Server started on port ${TEST_PORT}`)
  })

  afterAll(async () => {
    // Stop server if running
    if (server) {
      await server.stop()
      console.log('PGLite Socket Server stopped')
    }

    // Close database
    if (db) {
      await db.close()
      console.log('PGLite database closed')
    }
  })

  it('should execute a basic SELECT query using postgres client', async () => {
    // Extend test timeout
    expect.assertions(1)

    // Create a postgres client instance
    const sql = postgres({
      host: '127.0.0.1',
      port: TEST_PORT,
      database: 'postgres',
      username: 'postgres',
      password: 'postgres',
      idle_timeout: 5,
      connect_timeout: 10,
      max: 1, // Only use one connection
    })

    try {
      console.log('Attempting to connect to PGLite socket server...')

      // Execute a simple query
      console.log('Executing SELECT query...')
      const result = await sql`SELECT 1 as one`
      console.log('Query result:', result)

      // Check the results
      expect(result[0].one).toBe(1)
    } catch (error) {
      console.error('Test error:', error)
      throw error
    } finally {
      // Always close the client
      try {
        await sql.end()
        console.log('Postgres client connection closed')
      } catch (err) {
        console.error('Error while closing postgres client:', err)
      }
    }
  }, 15000)
})
