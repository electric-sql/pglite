import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from 'vitest'
import postgres from 'postgres'
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '../src'

/**
 * Debug configuration for testing
 *
 * To test against a real PostgreSQL server:
 * - Set DEBUG_TESTS=true as an environment variable
 * - Optionally set DEBUG_TESTS_REAL_SERVER with a connection URL (defaults to localhost)
 *
 * Example:
 * DEBUG_TESTS=true DEBUG_TESTS_REAL_SERVER=postgres://user:pass@host:port/db npm vitest ./tests/query-with-postgres-js.test.ts
 */
const DEBUG_LOCAL = process.env.DEBUG_LOCAL === 'true'
const DEBUG_TESTS = process.env.DEBUG_TESTS === 'true'
const DEBUG_TESTS_REAL_SERVER =
  process.env.DEBUG_TESTS_REAL_SERVER ||
  'postgres://postgres:postgres@localhost:5432/postgres'
const TEST_PORT = 5434

describe(`PGLite Socket Server`, () => {
  describe('with postgres.js client', () => {
    let db: PGlite
    let server: PGLiteSocketServer
    let sql: ReturnType<typeof postgres>
    let connectionConfig: any

    beforeAll(async () => {
      if (DEBUG_TESTS) {
        console.log('TESTING WITH REAL POSTGRESQL SERVER')
        console.log(`Connection URL: ${DEBUG_TESTS_REAL_SERVER}`)
      } else {
        console.log('TESTING WITH PGLITE SERVER')

        // Create a PGlite instance
        if (DEBUG_LOCAL) db = await PGlite.create({ debug: '1' })
        else db = await PGlite.create()

        // Wait for database to be ready
        await db.waitReady

        console.log('PGLite database ready')

        // Create and start the server with explicit host
        server = new PGLiteSocketServer({
          db,
          port: TEST_PORT,
          host: '127.0.0.1',
          inspect: DEBUG_TESTS || DEBUG_LOCAL,
        })

        // Add event listeners for debugging
        server.addEventListener('error', (event) => {
          console.error('Socket server error:', (event as CustomEvent).detail)
        })

        server.addEventListener('connection', (event) => {
          console.log(
            'Socket connection received:',
            (event as CustomEvent).detail,
          )
        })

        await server.start()
        console.log(`PGLite Socket Server started on port ${TEST_PORT}`)

        connectionConfig = {
          host: '127.0.0.1',
          port: TEST_PORT,
          database: 'postgres',
          username: 'postgres',
          password: 'postgres',
          idle_timeout: 5,
          connect_timeout: 10,
          max: 1,
        }
      }
    })

    afterAll(async () => {
      if (!DEBUG_TESTS) {
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
      }
    })

    beforeEach(() => {
      // Create a postgres client instance before each test
      if (DEBUG_TESTS) {
        // Direct connection to real PostgreSQL server using URL
        sql = postgres(DEBUG_TESTS_REAL_SERVER, {
          idle_timeout: 5,
          connect_timeout: 10,
          max: 1,
        })
      } else {
        // Connection to PGLite Socket Server
        sql = postgres(connectionConfig)
      }
    })

    afterEach(async () => {
      // Clean up any tables created in tests
      try {
        await sql`DROP TABLE IF EXISTS test_users`
      } catch (e) {
        console.error('Error cleaning up tables:', e)
      }

      // Disconnect the client after each test
      if (sql) {
        await sql.end()
      }
    })
    if (!DEBUG_LOCAL) {
      it('should execute a basic SELECT query', async () => {
        const result = await sql`SELECT 1 as one`
        expect(result[0].one).toBe(1)
      })

      it('should create a table', async () => {
        await sql`
        CREATE TABLE test_users (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `

        // Verify table exists by querying the schema
        const tableCheck = await sql`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'test_users'
      `

        expect(tableCheck.length).toBe(1)
        expect(tableCheck[0].table_name).toBe('test_users')
      })

      it('should insert rows into a table', async () => {
        // Create table
        await sql`
        CREATE TABLE test_users (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT
        )
      `

        // Insert data
        const insertResult = await sql`
        INSERT INTO test_users (name, email)
        VALUES
          ('Alice', 'alice@example.com'),
          ('Bob', 'bob@example.com')
        RETURNING *
      `

        expect(insertResult.length).toBe(2)
        expect(insertResult[0].name).toBe('Alice')
        expect(insertResult[1].name).toBe('Bob')

        // Verify data is there
        const count = await sql`SELECT COUNT(*)::int as count FROM test_users`
        expect(count[0].count).toBe(2)
      })

      it('should update rows in a table', async () => {
        // Create and populate table
        await sql`
        CREATE TABLE test_users (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT
        )
      `

        await sql`
        INSERT INTO test_users (name, email)
        VALUES ('Alice', 'alice@example.com')
      `

        // Update
        const updateResult = await sql`
        UPDATE test_users
        SET email = 'alice.new@example.com'
        WHERE name = 'Alice'
        RETURNING *
      `

        expect(updateResult.length).toBe(1)
        expect(updateResult[0].email).toBe('alice.new@example.com')
      })

      it('should delete rows from a table', async () => {
        // Create and populate table
        await sql`
        CREATE TABLE test_users (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT
        )
      `

        await sql`
        INSERT INTO test_users (name, email)
        VALUES
          ('Alice', 'alice@example.com'),
          ('Bob', 'bob@example.com')
      `

        // Delete
        const deleteResult = await sql`
        DELETE FROM test_users
        WHERE name = 'Alice'
        RETURNING *
      `

        expect(deleteResult.length).toBe(1)
        expect(deleteResult[0].name).toBe('Alice')

        // Verify only Bob remains
        const remaining = await sql`SELECT * FROM test_users`
        expect(remaining.length).toBe(1)
        expect(remaining[0].name).toBe('Bob')
      })

      it('should execute operations in a transaction', async () => {
        // Create table
        await sql`
        CREATE TABLE test_users (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          balance INTEGER DEFAULT 0
        )
      `

        // Insert initial data
        await sql`
        INSERT INTO test_users (name, balance)
        VALUES ('Alice', 100), ('Bob', 50)
      `

        // Start a transaction and perform operations
        await sql.begin(async (tx) => {
          // Deduct from Alice
          await tx`
          UPDATE test_users
          SET balance = balance - 30
          WHERE name = 'Alice'
        `

          // Add to Bob
          await tx`
          UPDATE test_users
          SET balance = balance + 30
          WHERE name = 'Bob'
        `
        })

        // Verify both operations succeeded
        const users =
          await sql`SELECT name, balance FROM test_users ORDER BY name`

        expect(users.length).toBe(2)
        expect(users[0].name).toBe('Alice')
        expect(users[0].balance).toBe(70)
        expect(users[1].name).toBe('Bob')
        expect(users[1].balance).toBe(80)
      })

      it('should rollback a transaction on ROLLBACK', async () => {
        // Create table
        await sql`
        CREATE TABLE test_users (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          balance INTEGER DEFAULT 0
        )
      `

        // Insert initial data
        await sql`
        INSERT INTO test_users (name, balance)
        VALUES ('Alice', 100), ('Bob', 50)
      `

        // Get initial balance
        const initialResult = await sql`
        SELECT balance FROM test_users WHERE name = 'Alice'
      `
        const initialBalance = initialResult[0].balance

        // Start a transaction
        await sql
          .begin(async (tx) => {
            // Deduct from Alice
            await tx`
          UPDATE test_users
          SET balance = balance - 30
          WHERE name = 'Alice'
        `

            // Verify balance is changed within transaction
            const midResult = await tx`
          SELECT balance FROM test_users WHERE name = 'Alice'
        `
            expect(midResult[0].balance).toBe(70)

            // Explicitly roll back (cancel) the transaction
            throw new Error('Triggering rollback')
          })
          .catch(() => {
            // Expected error to trigger rollback
            console.log('Transaction was rolled back as expected')
          })

        // Verify balance wasn't changed after rollback
        const finalResult = await sql`
        SELECT balance FROM test_users WHERE name = 'Alice'
      `
        expect(finalResult[0].balance).toBe(initialBalance)
      })

      it('should rollback a transaction on error', async () => {
        // Create table
        await sql`
        CREATE TABLE test_users (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          balance INTEGER DEFAULT 0
        )
      `

        // Insert initial data
        await sql`
        INSERT INTO test_users (name, balance)
        VALUES ('Alice', 100), ('Bob', 50)
      `

        // Start a transaction that will fail
        try {
          await sql.begin(async (tx) => {
            // Deduct from Alice
            await tx`
            UPDATE test_users
            SET balance = balance - 30
            WHERE name = 'Alice'
          `

            // This will trigger an error
            await tx`
            UPDATE test_users_nonexistent
            SET balance = balance + 30
            WHERE name = 'Bob'
          `
          })
        } catch (error) {
          // Expected to fail
        }

        // Verify Alice's balance was not changed due to rollback
        const users =
          await sql`SELECT name, balance FROM test_users ORDER BY name`

        expect(users.length).toBe(2)
        expect(users[0].name).toBe('Alice')
        expect(users[0].balance).toBe(100) // Should remain 100 after rollback
      })

      it('should handle a syntax error', async () => {
        // Expect syntax error
        let errorMessage = ''
        try {
          await sql`THIS IS NOT VALID SQL;`
        } catch (error) {
          errorMessage = (error as Error).message
        }

        expect(errorMessage).not.toBe('')
        expect(errorMessage.toLowerCase()).toContain('syntax error')
      })

      it('should support cursor-based pagination', async () => {
        // Create a test table with many rows
        await sql`
        CREATE TABLE test_users (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          value INTEGER
        )
      `

        // Insert 100 rows using generate_series (server-side generation)
        await sql`
        INSERT INTO test_users (name, value)
        SELECT
          'User ' || i as name,
          i as value
        FROM generate_series(1, 100) as i
      `

        // Use a cursor to read data in smaller chunks
        const chunkSize = 10
        let results: any[] = []
        let page = 0

        // Use a transaction for cursor operations (cursors must be in transactions)
        await sql.begin(async (tx) => {
          // Declare a cursor
          await tx`DECLARE user_cursor CURSOR FOR SELECT * FROM test_users ORDER BY id`

          let hasMoreData = true
          while (hasMoreData) {
            // Fetch a batch of results
            const chunk = await tx`FETCH 10 FROM user_cursor`

            // If no rows returned, we're done
            if (chunk.length === 0) {
              hasMoreData = false
              continue
            }

            // Process this chunk
            page++

            // Add to our results array
            results = [...results, ...chunk]

            // Verify each chunk has correct data (except possibly the last one)
            if (chunk.length === chunkSize) {
              expect(chunk.length).toBe(chunkSize)
              expect(chunk[0].id).toBe((page - 1) * chunkSize + 1)
            }
          }

          // Close the cursor
          await tx`CLOSE user_cursor`
        })

        // Verify we got all 100 records
        expect(results.length).toBe(100)
        expect(results[0].name).toBe('User 1')
        expect(results[99].name).toBe('User 100')

        // Verify we received the expected number of pages
        expect(page).toBe(Math.ceil(100 / chunkSize))
      })
    } else {
      it('should support LISTEN/NOTIFY for pub/sub messaging', async () => {
        // Create a promise that will resolve when the notification is received
        let receivedPayload = ''
        const notificationPromise = new Promise<void>((resolve) => {
          // Set up listener for the 'test_channel' notification
          sql.listen('test_channel', (data) => {
            receivedPayload = data
            resolve()
          })
        })

        // Small delay to ensure listener is set up
        // await new Promise((resolve) => setTimeout(resolve, 100))

        // Send a notification on the same connection
        await sql`NOTIFY test_channel, 'Hello from PGlite!'`

        // Wait for the notification to be received
        await notificationPromise

        // Verify the notification was received with the correct payload
        expect(receivedPayload).toBe('Hello from PGlite!')
      })
    }
  })
})
