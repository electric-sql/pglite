/// <reference types="node" />
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { Client } from 'pg'
import { PGlite, PGliteInterfaceExtensions } from '@electric-sql/pglite'
import { electricSync } from '../src/index.js'
import { MultiShapeMessages } from '@electric-sql/experimental'

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:54321/electric?sslmode=disable'
const ELECTRIC_URL = process.env.ELECTRIC_URL || 'http://localhost:3000/v1/shape'

type MultiShapeMessage = MultiShapeMessages<any>

// Define types for our database records
interface TodoRecord {
  id: number
  task: string
  done: boolean
}

interface ProjectRecord {
  id: number
  name: string
  active: boolean
}

interface CountResult {
  count: number
}

describe('sync-e2e', () => {
  let pgClient: typeof Client.prototype
  let pg: PGlite & PGliteInterfaceExtensions<{ electric: ReturnType<typeof electricSync> }>

  // Setup PostgreSQL client and tables
  beforeAll(async () => {
    // Connect to PostgreSQL
    pgClient = new Client({
      connectionString: DATABASE_URL
    })
    await pgClient.connect()

    // Create test tables in PostgreSQL
    const res = await pgClient.query(`
      CREATE TABLE IF NOT EXISTS todo (
        id SERIAL PRIMARY KEY,
        task TEXT,
        done BOOLEAN
      );
    `)
    console.log(res)
    await pgClient.query('TRUNCATE todo;')
    const res2 = await pgClient.query('SELECT * FROM todo;')
    console.log(res2)

    // Create PGlite instance with electric sync extension
    pg = await PGlite.create({
      extensions: {
        electric: electricSync(),
      },
    })

    // Create the same tables in PGlite
    await pg.exec(`
      CREATE TABLE IF NOT EXISTS todo (
        id SERIAL PRIMARY KEY,
        task TEXT,
        done BOOLEAN
      );
    `)
  })

  afterAll(async () => {
    // Clean up
    await pgClient.query('DROP TABLE IF EXISTS todo;')
    await pgClient.end()
  })

  beforeEach(async () => {
    // Clear tables before each test
    await pgClient.query('TRUNCATE todo;')
    await pg.exec('TRUNCATE todo;')
  })

  // Helper function to wait for an expectation to pass
  const waitForExpect = async (
    expectFn: () => Promise<void> | void,
    { timeout = 5000, interval = 50 } = {}
  ): Promise<void> => {
    const startTime = Date.now()
    
    while (true) {
      try {
        await expectFn()
        return // Success! Expectation passed
      } catch (error) {
        if (Date.now() - startTime > timeout) {
          throw new Error(`Expectation not met within ${timeout}ms: ${error}`)
        }
        await new Promise(resolve => setTimeout(resolve, interval))
      }
    }
  }

  it('handles inserts/updates/deletes', async () => {
    const shape = await pg.electric.syncShapeToTable({
      shape: {
        url: ELECTRIC_URL,
        params: { table: 'todo' },
      },
      table: 'todo',
      primaryKey: ['id'],
      shapeKey: null,
    })

    // Insert data into PostgreSQL
    await pgClient.query(`
      INSERT INTO todo (id, task, done) 
      VALUES (1, 'task1', false);
    `)

    await waitForExpect(
      async () => {
        const result = await pg.sql`SELECT * FROM todo;`
        expect(result.rows.length).toBe(1)
      }
    )

    expect((await pg.sql`SELECT * FROM todo;`).rows).toEqual([
      {
        id: 1,
        task: 'task1',
        done: false,
      },
    ])

    // Update data in PostgreSQL
    await pgClient.query(`
      UPDATE todo SET task = 'task2', done = true WHERE id = 1;
    `)

    await waitForExpect(
      async () => {
        const result = await pg.sql`SELECT * FROM todo WHERE task = 'task2' AND done = true;`
        expect(result.rows.length).toBe(1)
      }
    )

    expect((await pg.sql`SELECT * FROM todo;`).rows).toEqual([
      {
        id: 1,
        task: 'task2',
        done: true,
      },
    ])

    // Delete data in PostgreSQL
    await pgClient.query(`
      DELETE FROM todo WHERE id = 1;
    `)

    await waitForExpect(
      async () => {
        const result = await pg.sql`SELECT * FROM todo;`
        expect(result.rows.length).toBe(0)
      }
    )

    expect((await pg.sql`SELECT * FROM todo;`).rows).toEqual([])

    shape.unsubscribe()
  })
})