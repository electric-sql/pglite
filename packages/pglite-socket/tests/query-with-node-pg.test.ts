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
import { spawn, ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import fs from 'fs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

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

  describe('with extensions via CLI', () => {
    const UNIX_SOCKET_DIR_PATH = `/tmp/${Date.now().toString()}`
    fs.mkdirSync(UNIX_SOCKET_DIR_PATH)
    const UNIX_SOCKET_PATH = `${UNIX_SOCKET_DIR_PATH}/.s.PGSQL.5432`
    let serverProcess: ChildProcess | null = null
    let client: typeof Client.prototype

    beforeAll(async () => {
      // Start the server with extensions via CLI using tsx for dev or node for dist
      const serverScript = join(__dirname, '../src/scripts/server.ts')
      serverProcess = spawn(
        'npx',
        [
          'tsx',
          serverScript,
          '--path',
          UNIX_SOCKET_PATH,
          '--extensions',
          'vector,pg_uuidv7,@electric-sql/pglite/pg_hashids:pg_hashids',
        ],
        {
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      )

      // Wait for server to be ready by checking for "listening" message
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Server startup timeout'))
        }, 30000)

        const onData = (data: Buffer) => {
          const output = data.toString()
          if (output.includes('listening')) {
            clearTimeout(timeout)
            resolve()
          }
        }

        serverProcess!.stdout?.on('data', onData)
        serverProcess!.stderr?.on('data', (data) => {
          console.error('Server stderr:', data.toString())
        })

        serverProcess!.on('error', (err) => {
          clearTimeout(timeout)
          reject(err)
        })

        serverProcess!.on('exit', (code) => {
          if (code !== 0 && code !== null) {
            clearTimeout(timeout)
            reject(new Error(`Server exited with code ${code}`))
          }
        })
      })

      console.log('Server with extensions started')

      client = new Client({
        host: UNIX_SOCKET_DIR_PATH,
        database: 'postgres',
        user: 'postgres',
        password: 'postgres',
        connectionTimeoutMillis: 10000,
      })
      await client.connect()
    })

    afterAll(async () => {
      if (client) {
        await client.end().catch(() => {})
      }

      if (serverProcess) {
        serverProcess.kill('SIGTERM')
        await new Promise<void>((resolve) => {
          serverProcess!.on('exit', () => resolve())
          setTimeout(resolve, 2000) // Force resolve after 2s
        })
      }
    })

    it('should load and use vector extension', async () => {
      // Create the extension
      await client.query('CREATE EXTENSION IF NOT EXISTS vector')

      // Verify extension is loaded
      const extCheck = await client.query(`
        SELECT extname FROM pg_extension WHERE extname = 'vector'
      `)
      expect(extCheck.rows).toHaveLength(1)
      expect(extCheck.rows[0].extname).toBe('vector')

      // Create a table with vector column
      await client.query(`
        CREATE TABLE test_vectors (
          id SERIAL PRIMARY KEY,
          name TEXT,
          vec vector(3)
        )
      `)

      // Insert test data
      await client.query(`
        INSERT INTO test_vectors (name, vec) VALUES
          ('test1', '[1,2,3]'),
          ('test2', '[4,5,6]'),
          ('test3', '[7,8,9]')
      `)

      // Query with vector distance
      const result = await client.query(`
        SELECT name, vec, vec <-> '[3,1,2]' AS distance
        FROM test_vectors
        ORDER BY distance
      `)

      expect(result.rows).toHaveLength(3)
      expect(result.rows[0].name).toBe('test1')
      expect(result.rows[0].vec).toBe('[1,2,3]')
      expect(parseFloat(result.rows[0].distance)).toBeCloseTo(2.449, 2)
    })

    it('should load and use pg_uuidv7 extension', async () => {
      // Create the extension
      await client.query('CREATE EXTENSION IF NOT EXISTS pg_uuidv7')

      // Verify extension is loaded
      const extCheck = await client.query(`
        SELECT extname FROM pg_extension WHERE extname = 'pg_uuidv7'
      `)
      expect(extCheck.rows).toHaveLength(1)
      expect(extCheck.rows[0].extname).toBe('pg_uuidv7')

      // Generate a UUIDv7
      const result = await client.query('SELECT uuid_generate_v7() as uuid')
      expect(result.rows[0].uuid).toHaveLength(36)

      // Test uuid_v7_to_timestamptz function
      const tsResult = await client.query(`
        SELECT uuid_v7_to_timestamptz('018570bb-4a7d-7c7e-8df4-6d47afd8c8fc') as ts
      `)
      const timestamp = new Date(tsResult.rows[0].ts)
      expect(timestamp.toISOString()).toBe('2023-01-02T04:26:40.637Z')
    })

    it('should load and use pg_hashids extension from npm package path', async () => {
      // Create the extension
      await client.query('CREATE EXTENSION IF NOT EXISTS pg_hashids')

      // Verify extension is loaded
      const extCheck = await client.query(`
        SELECT extname FROM pg_extension WHERE extname = 'pg_hashids'
      `)
      expect(extCheck.rows).toHaveLength(1)
      expect(extCheck.rows[0].extname).toBe('pg_hashids')

      // Test id_encode function
      const result = await client.query(`
        SELECT id_encode(1234567, 'salt', 10, 'abcdefghijABCDEFGHIJ1234567890') as hash
      `)
      expect(result.rows[0].hash).toBeTruthy()
      expect(typeof result.rows[0].hash).toBe('string')

      // Test id_decode function (round-trip)
      const hash = result.rows[0].hash
      const decodeResult = await client.query(`
        SELECT id_decode('${hash}', 'salt', 10, 'abcdefghijABCDEFGHIJ1234567890') as id
      `)
      expect(decodeResult.rows[0].id[0]).toBe('1234567')
    })
  })
})
