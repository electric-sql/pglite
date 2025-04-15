import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from 'vitest'
import { Client } from 'pg'
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
 * DEBUG_TESTS=true DEBUG_TESTS_REAL_SERVER=postgres://user:pass@host:port/db npm vitest ./tests/query-with-node-pg.test.ts
 */
const DEBUG_TESTS = process.env.DEBUG_TESTS === 'true'
const DEBUG_TESTS_REAL_SERVER =
  process.env.DEBUG_TESTS_REAL_SERVER ||
  'postgres://postgres:postgres@localhost:5432/postgres'
const TEST_PORT = 5434

describe(`PGLite Socket Server`, () => {
  describe('with node-pg client', () => {
    let db: PGlite
    let server: PGLiteSocketServer
    let client: typeof Client.prototype
    let connectionConfig: any

    beforeAll(async () => {
      if (DEBUG_TESTS) {
        console.log('TESTING WITH REAL POSTGRESQL SERVER')
        console.log(`Connection URL: ${DEBUG_TESTS_REAL_SERVER}`)
      } else {
        console.log('TESTING WITH PGLITE SERVER')

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
          user: 'postgres',
          password: 'postgres',
          // Connection timeout in milliseconds
          connectionTimeoutMillis: 10000,
          // Query timeout in milliseconds
          statement_timeout: 5000,
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

    beforeEach(async () => {
      // Create pg client instance before each test
      if (DEBUG_TESTS) {
        // Direct connection to real PostgreSQL server using URL
        client = new Client({
          connectionString: DEBUG_TESTS_REAL_SERVER,
          connectionTimeoutMillis: 10000,
          statement_timeout: 5000,
        })
      } else {
        // Connection to PGLite Socket Server
        client = new Client(connectionConfig)
      }

      // Connect the client
      await client.connect()
    })

    afterEach(async () => {
      // Clean up any tables created in tests
      try {
        await client.query('DROP TABLE IF EXISTS test_users')
      } catch (e) {
        console.error('Error cleaning up tables:', e)
      }

      // Disconnect the client after each test
      if (client) {
        await client.end()
      }
    })

    it('should execute a basic SELECT query', async () => {
      const result = await client.query('SELECT 1 as one')
      expect(result.rows[0].one).toBe(1)
    })

    it('should create a table', async () => {
      await client.query(`
        CREATE TABLE test_users (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `)

      // Verify table exists by querying the schema
      const tableCheck = await client.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'test_users'
      `)

      expect(tableCheck.rows.length).toBe(1)
      expect(tableCheck.rows[0].table_name).toBe('test_users')
    })

    it('should insert rows into a table', async () => {
      // Create table
      await client.query(`
        CREATE TABLE test_users (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT
        )
      `)

      // Insert data
      const insertResult = await client.query(`
        INSERT INTO test_users (name, email)
        VALUES 
          ('Alice', 'alice@example.com'),
          ('Bob', 'bob@example.com')
        RETURNING *
      `)

      expect(insertResult.rows.length).toBe(2)
      expect(insertResult.rows[0].name).toBe('Alice')
      expect(insertResult.rows[1].name).toBe('Bob')

      // Verify data is there
      const count = await client.query(
        'SELECT COUNT(*)::int as count FROM test_users',
      )
      expect(count.rows[0].count).toBe(2)
    })

    it('should update rows in a table', async () => {
      // Create and populate table
      await client.query(`
        CREATE TABLE test_users (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT
        )
      `)

      await client.query(`
        INSERT INTO test_users (name, email)
        VALUES ('Alice', 'alice@example.com')
      `)

      // Update
      const updateResult = await client.query(`
        UPDATE test_users
        SET email = 'alice.new@example.com'
        WHERE name = 'Alice'
        RETURNING *
      `)

      expect(updateResult.rows.length).toBe(1)
      expect(updateResult.rows[0].email).toBe('alice.new@example.com')
    })

    it('should delete rows from a table', async () => {
      // Create and populate table
      await client.query(`
        CREATE TABLE test_users (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT
        )
      `)

      await client.query(`
        INSERT INTO test_users (name, email)
        VALUES 
          ('Alice', 'alice@example.com'),
          ('Bob', 'bob@example.com')
      `)

      // Delete
      const deleteResult = await client.query(`
        DELETE FROM test_users
        WHERE name = 'Alice'
        RETURNING *
      `)

      expect(deleteResult.rows.length).toBe(1)
      expect(deleteResult.rows[0].name).toBe('Alice')

      // Verify only Bob remains
      const remaining = await client.query('SELECT * FROM test_users')
      expect(remaining.rows.length).toBe(1)
      expect(remaining.rows[0].name).toBe('Bob')
    })

    it('should execute operations in a transaction', async () => {
      // Create table
      await client.query(`
        CREATE TABLE test_users (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          balance INTEGER DEFAULT 0
        )
      `)

      // Insert initial data
      await client.query(`
        INSERT INTO test_users (name, balance)
        VALUES ('Alice', 100), ('Bob', 50)
      `)

      // Start a transaction and perform operations
      await client.query('BEGIN')

      try {
        // Deduct from Alice
        await client.query(`
          UPDATE test_users
          SET balance = balance - 30
          WHERE name = 'Alice'
        `)

        // Add to Bob
        await client.query(`
          UPDATE test_users
          SET balance = balance + 30
          WHERE name = 'Bob'
        `)

        // Commit the transaction
        await client.query('COMMIT')
      } catch (error) {
        // Rollback on error
        await client.query('ROLLBACK')
        throw error
      }

      // Verify both operations succeeded
      const users = await client.query(
        'SELECT name, balance FROM test_users ORDER BY name',
      )

      expect(users.rows.length).toBe(2)
      expect(users.rows[0].name).toBe('Alice')
      expect(users.rows[0].balance).toBe(70)
      expect(users.rows[1].name).toBe('Bob')
      expect(users.rows[1].balance).toBe(80)
    })

    it('should rollback a transaction on ROLLBACK', async () => {
      // Create table
      await client.query(`
        CREATE TABLE test_users (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          balance INTEGER DEFAULT 0
        )
      `)

      // Insert initial data
      await client.query(`
        INSERT INTO test_users (name, balance)
        VALUES ('Alice', 100), ('Bob', 50)
      `)

      // Get initial balance
      const initialResult = await client.query(`
        SELECT balance FROM test_users WHERE name = 'Alice'
      `)
      const initialBalance = initialResult.rows[0].balance

      // Start a transaction
      await client.query('BEGIN')

      try {
        // Deduct from Alice
        await client.query(`
          UPDATE test_users
          SET balance = balance - 30
          WHERE name = 'Alice'
        `)

        // Verify balance is changed within transaction
        const midResult = await client.query(`
          SELECT balance FROM test_users WHERE name = 'Alice'
        `)
        expect(midResult.rows[0].balance).toBe(70)

        // Explicitly roll back (cancel) the transaction
        await client.query('ROLLBACK')
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      }

      // Verify balance wasn't changed after rollback
      const finalResult = await client.query(`
        SELECT balance FROM test_users WHERE name = 'Alice'
      `)
      expect(finalResult.rows[0].balance).toBe(initialBalance)
    })

    it('should rollback a transaction on error', async () => {
      // Create table
      await client.query(`
        CREATE TABLE test_users (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          balance INTEGER DEFAULT 0
        )
      `)

      // Insert initial data
      await client.query(`
        INSERT INTO test_users (name, balance)
        VALUES ('Alice', 100), ('Bob', 50)
      `)

      try {
        // Start a transaction
        await client.query('BEGIN')

        // Deduct from Alice
        await client.query(`
          UPDATE test_users
          SET balance = balance - 30
          WHERE name = 'Alice'
        `)

        // This will trigger an error
        await client.query(`
          UPDATE test_users_nonexistent
          SET balance = balance + 30
          WHERE name = 'Bob'
        `)

        // Should never get here
        await client.query('COMMIT')
      } catch (error) {
        // Expected to fail - rollback transaction
        await client.query('ROLLBACK').catch(() => {
          // If the client connection is in a bad state, we just ignore
          // the rollback error
        })
      }

      // Verify Alice's balance was not changed due to rollback
      const users = await client.query(
        'SELECT name, balance FROM test_users ORDER BY name',
      )

      expect(users.rows.length).toBe(2)
      expect(users.rows[0].name).toBe('Alice')
      expect(users.rows[0].balance).toBe(100) // Should remain 100 after rollback
    })

    it('should handle a syntax error', async () => {
      // Expect syntax error
      let errorMessage = ''
      try {
        await client.query('THIS IS NOT VALID SQL;')
      } catch (error) {
        errorMessage = (error as Error).message
      }

      expect(errorMessage).not.toBe('')
      expect(errorMessage.toLowerCase()).toContain('syntax error')
    })

    it('should support cursor-based pagination', async () => {
      // Create a test table with many rows
      await client.query(`
        CREATE TABLE test_users (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          value INTEGER
        )
      `)

      // Insert 100 rows using generate_series (server-side generation)
      await client.query(`
        INSERT INTO test_users (name, value)
        SELECT 
          'User ' || i as name,
          i as value
        FROM generate_series(1, 100) as i
      `)

      // Use a cursor to read data in smaller chunks
      const chunkSize = 10
      let results: any[] = []
      let page = 0

      try {
        // Begin transaction
        await client.query('BEGIN')

        // Declare a cursor
        await client.query(
          'DECLARE user_cursor CURSOR FOR SELECT * FROM test_users ORDER BY id',
        )

        let hasMoreData = true
        while (hasMoreData) {
          // Fetch a batch of results
          const chunk = await client.query('FETCH 10 FROM user_cursor')

          // If no rows returned, we're done
          if (chunk.rows.length === 0) {
            hasMoreData = false
            continue
          }

          // Process this chunk
          page++

          // Add to our results array
          results = [...results, ...chunk.rows]

          // Verify each chunk has correct data (except possibly the last one)
          if (chunk.rows.length === chunkSize) {
            expect(chunk.rows.length).toBe(chunkSize)
            expect(chunk.rows[0].id).toBe((page - 1) * chunkSize + 1)
          }
        }

        // Close the cursor
        await client.query('CLOSE user_cursor')

        // Commit transaction
        await client.query('COMMIT')
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      }

      // Verify we got all 100 records
      expect(results.length).toBe(100)
      expect(results[0].name).toBe('User 1')
      expect(results[99].name).toBe('User 100')

      // Verify we received the expected number of pages
      expect(page).toBe(Math.ceil(100 / chunkSize))
    })

    it('should support LISTEN/NOTIFY for pub/sub messaging', async () => {
      // Set up listener for notifications
      let receivedPayload = ''
      const notificationReceived = new Promise<void>((resolve) => {
        client.on('notification', (msg) => {
          receivedPayload = msg.payload || ''
          resolve()
        })
      })

      // Start listening
      await client.query('LISTEN test_channel')

      // Small delay to ensure listener is set up
      await new Promise((resolve) => setTimeout(resolve, 100))

      // Send a notification
      await client.query("NOTIFY test_channel, 'Hello from PGlite!'")

      // Wait for the notification to be received with an appropriate timeout
      const timeoutPromise = new Promise<void>((_, reject) => {
        setTimeout(() => reject(new Error('Notification timeout')), 2000)
      })

      await Promise.race([notificationReceived, timeoutPromise]).catch(
        (error) => {
          console.error('Notification error:', error)
        },
      )

      // Verify the notification was received with the correct payload
      expect(receivedPayload).toBe('Hello from PGlite!')
    })
  })
})
