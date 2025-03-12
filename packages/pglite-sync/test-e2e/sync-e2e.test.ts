/// <reference types="node" />
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  vi,
} from 'vitest'
import { Client } from 'pg'
import { PGlite, PGliteInterfaceExtensions } from '@electric-sql/pglite'
import { electricSync } from '../src/index.js'

const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://postgres:password@localhost:54321/electric?sslmode=disable'
const ELECTRIC_URL =
  process.env.ELECTRIC_URL || 'http://localhost:3000/v1/shape'

const shapeHandles: Map<string, string> = new Map()

const fetchClient: typeof fetch = async (
  url: string | Request | URL,
  options: RequestInit = {},
) => {
  let table: string | null = null
  if (typeof url === 'string') {
    table = new URL(url).searchParams.get('table')
  } else if (url instanceof Request) {
    table = new URL(url.url).searchParams.get('table')
  } else if (url instanceof URL) {
    table = url.searchParams.get('table')
  }
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
    },
  })
  if (table) {
    shapeHandles.set(res.headers.get('electric-handle')!, table)
  }
  return res
}

const deleteShape = async (table: string, handle: string) => {
  const deleteUrl = new URL(ELECTRIC_URL)
  deleteUrl.searchParams.set('table', table)
  deleteUrl.searchParams.set('handle', handle)
  const res = await fetch(deleteUrl, {
    method: 'DELETE',
  })
  if (res.status === 404) {
    // Nothing to delete
    return
  }
  if (!res.ok) {
    throw new Error(`Failed to delete shape: ${res.statusText}`)
  }
}

const deleteAllShapes = async () => {
  for (const [handle, table] of shapeHandles.entries()) {
    await deleteShape(table, handle)
  }
  shapeHandles.clear()
}

const deleteAllShapesForTable = async (table: string) => {
  for (const [handle, table] of shapeHandles.entries()) {
    if (table === table) {
      await deleteShape(table, handle)
    }
  }
}

describe('sync-e2e', () => {
  let pgClient: typeof Client.prototype
  let pg: PGlite &
    PGliteInterfaceExtensions<{ electric: ReturnType<typeof electricSync> }>

  // Setup PostgreSQL client and tables
  beforeAll(async () => {
    // Connect to PostgreSQL
    pgClient = new Client({
      connectionString: DATABASE_URL,
    })
    await pgClient.connect()

    // Create test tables in PostgreSQL
    await pgClient.query(`
      CREATE TABLE IF NOT EXISTS todo (
        id SERIAL PRIMARY KEY,
        task TEXT,
        done BOOLEAN
      );
    `)
  })

  afterAll(async () => {
    await pgClient.query('TRUNCATE todo;')
    await pgClient.end()
    await deleteAllShapes()
  })

  beforeEach(async () => {
    // Create PGlite instance with electric sync extension
    pg = await PGlite.create({
      extensions: {
        electric: electricSync(),
      },
    })

    // Create the same tables in PGlite
    await pg.exec(`
      CREATE TABLE todo (
        id SERIAL PRIMARY KEY,
        task TEXT,
        done BOOLEAN
      );
    `)
  })

  afterEach(async () => {
    await pg.close()
    await deleteAllShapes()
    await pgClient.query('TRUNCATE todo;')
  })

  it('handles inserts/updates/deletes', async () => {
    const shape = await pg.electric.syncShapeToTable({
      shape: {
        url: ELECTRIC_URL,
        params: { table: 'todo' },
        fetchClient,
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

    // Wait for sync to complete
    await vi.waitFor(async () => {
      const result = await pg.sql`SELECT * FROM todo;`
      expect(result.rows).toEqual([
        {
          id: 1,
          task: 'task1',
          done: false,
        },
      ])
    })

    // Update data in PostgreSQL
    await pgClient.query(`
      UPDATE todo SET task = 'task2', done = true WHERE id = 1;
    `)

    // Wait for sync to complete
    await vi.waitFor(async () => {
      const result = await pg.sql`SELECT * FROM todo;`
      expect(result.rows).toEqual([
        {
          id: 1,
          task: 'task2',
          done: true,
        },
      ])
    })

    // Delete data in PostgreSQL
    await pgClient.query(`
      DELETE FROM todo WHERE id = 1;
    `)

    // Wait for sync to complete
    await vi.waitFor(async () => {
      const result = await pg.sql`SELECT * FROM todo;`
      expect(result.rows).toEqual([])
    })

    shape.unsubscribe()
  })

  it('performs operations within a transaction', async () => {
    const shape = await pg.electric.syncShapeToTable({
      shape: {
        url: ELECTRIC_URL,
        params: { table: 'todo' },
      },
      table: 'todo',
      primaryKey: ['id'],
      shapeKey: null,
    })

    // Insert a large batch of records to test transaction behavior
    const numInserts = 1000 // Reduced from 10000 in the mock test for practical e2e testing
    const numBatches = 5
    const batchSize = Math.floor(numInserts / numBatches)

    for (let i = 0; i < numBatches; i++) {
      const values = Array.from({ length: batchSize }, (_, idx) => {
        const itemIdx = i * batchSize + idx
        return `(${itemIdx}, 'task${itemIdx}', false)`
      }).join(', ')

      await pgClient.query(`
        INSERT INTO todo (id, task, done) 
        VALUES ${values};
      `)
    }

    // Wait for all inserts to be synced
    await vi.waitFor(
      async () => {
        const result = await pg.sql<{
          count: number
        }>`SELECT COUNT(*) as count FROM todo;`
        expect(result.rows[0].count).toBe(numInserts)
      },
      { timeout: 10000 }, // Increase timeout for larger batch
    )

    // Verify some sample data
    const firstItem = await pg.sql`SELECT * FROM todo WHERE id = 0;`
    expect(firstItem.rows[0]).toEqual({
      id: 0,
      task: 'task0',
      done: false,
    })

    const lastItem =
      await pg.sql`SELECT * FROM todo WHERE id = ${numInserts - 1};`
    expect(lastItem.rows[0]).toEqual({
      id: numInserts - 1,
      task: `task${numInserts - 1}`,
      done: false,
    })

    shape.unsubscribe()
  })

  it('persists shape stream state and automatically resumes', async () => {
    // First sync session with a persistent key
    let shape = await pg.electric.syncShapeToTable({
      shape: {
        url: ELECTRIC_URL,
        params: { table: 'todo' },
      },
      table: 'todo',
      primaryKey: ['id'],
      shapeKey: 'persistent_sync_test',
    })

    // Insert initial batch of data
    const numInserts = 3
    for (let i = 0; i < numInserts; i++) {
      await pgClient.query(`
        INSERT INTO todo (id, task, done) 
        VALUES (${i}, 'task${i}', false);
      `)
    }

    // Wait for initial sync to complete
    await vi.waitFor(async () => {
      const result = await pg.sql<{
        count: number
      }>`SELECT COUNT(*) as count FROM todo;`
      expect(result.rows[0].count).toBe(numInserts)
    })

    // Unsubscribe from first sync session
    shape.unsubscribe()

    // Clear local data to simulate a fresh start
    await pg.exec('TRUNCATE todo;')

    // Start a new sync session with the same key
    shape = await pg.electric.syncShapeToTable({
      shape: {
        url: ELECTRIC_URL,
        params: { table: 'todo' },
      },
      table: 'todo',
      primaryKey: ['id'],
      shapeKey: 'persistent_sync_test',
    })

    // Wait for sync to resume and restore data
    await vi.waitFor(async () => {
      const result = await pg.sql<{
        count: number
      }>`SELECT COUNT(*) as count FROM todo;`
      expect(result.rows[0].count).toBe(numInserts)
    })

    // Verify the data was restored
    const result = await pg.sql`SELECT * FROM todo ORDER BY id;`
    expect(result.rows.length).toBe(numInserts)
    expect(result.rows[0]).toEqual({
      id: 0,
      task: 'task0',
      done: false,
    })

    // Clean up
    shape.unsubscribe()
    await pg.electric.deleteSubscription('persistent_sync_test')
  })

  it('syncs multiple shapes to multiple tables simultaneously', async () => {
    // Create a second table for testing multi-shape sync
    await pgClient.query(`
      CREATE TABLE IF NOT EXISTS project (
        id SERIAL PRIMARY KEY,
        name TEXT,
        active BOOLEAN
      );
    `)
    await pgClient.query('TRUNCATE project;')

    await pg.exec(`
      CREATE TABLE IF NOT EXISTS project (
        id SERIAL PRIMARY KEY,
        name TEXT,
        active BOOLEAN
      );
    `)
    await pg.exec('TRUNCATE project;')

    // Set up sync for both tables
    const todoShape = await pg.electric.syncShapeToTable({
      shape: {
        url: ELECTRIC_URL,
        params: { table: 'todo' },
      },
      table: 'todo',
      primaryKey: ['id'],
      shapeKey: null,
    })

    const projectShape = await pg.electric.syncShapeToTable({
      shape: {
        url: ELECTRIC_URL,
        params: { table: 'project' },
      },
      table: 'project',
      primaryKey: ['id'],
      shapeKey: null,
    })

    // Insert data into both tables in PostgreSQL
    await pgClient.query(`
      INSERT INTO todo (id, task, done) 
      VALUES (1, 'task1', false), (2, 'task2', true);
    `)

    await pgClient.query(`
      INSERT INTO project (id, name, active) 
      VALUES (1, 'Project 1', true), (2, 'Project 2', false);
    `)

    // Wait for todo table sync to complete
    await vi.waitFor(async () => {
      const result = await pg.sql<{
        count: number
      }>`SELECT COUNT(*) as count FROM todo;`
      expect(result.rows[0].count).toBe(2)
    })

    // Wait for project table sync to complete
    await vi.waitFor(async () => {
      const result = await pg.sql<{
        count: number
      }>`SELECT COUNT(*) as count FROM project;`
      expect(result.rows[0].count).toBe(2)
    })

    // Verify data was inserted into both tables
    const todoResult = await pg.sql`SELECT * FROM todo ORDER BY id;`
    expect(todoResult.rows).toEqual([
      { id: 1, task: 'task1', done: false },
      { id: 2, task: 'task2', done: true },
    ])

    const projectResult = await pg.sql`SELECT * FROM project ORDER BY id;`
    expect(projectResult.rows).toEqual([
      { id: 1, name: 'Project 1', active: true },
      { id: 2, name: 'Project 2', active: false },
    ])

    // Clean up
    todoShape.unsubscribe()
    projectShape.unsubscribe()
    await pgClient.query('DROP TABLE IF EXISTS project;')
    await pg.exec('DROP TABLE IF EXISTS project;')
  })
})
