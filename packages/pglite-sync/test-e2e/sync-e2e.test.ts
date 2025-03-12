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

const LOG_FETCH = false
let fetchCount = 0

const fetchClient: typeof fetch = async (
  url: string | Request | URL,
  options: RequestInit = {},
) => {
  fetchCount++
  if (LOG_FETCH) {
    console.log('>> fetch', fetchCount, url, options)
  }
  let table: string | null = null
  if (typeof url === 'string') {
    table = new URL(url).searchParams.get('table')
  } else if (url instanceof Request) {
    table = new URL(url.url).searchParams.get('table')
  } else if (url instanceof URL) {
    table = url.searchParams.get('table')
  }
  let res: Response
  try {
    res = await fetch(url, options)
  } catch (e) {
    if (LOG_FETCH) {
      console.log('>> fetch error', fetchCount, e)
    }
    throw e
  }
  if (table) {
    shapeHandles.set(res.headers.get('electric-handle')!, table)
  }
  if (LOG_FETCH) {
    console.log(
      '>> fetch res',
      fetchCount,
      res.status,
      res.statusText,
      res.headers,
    )
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
    throw new Error(`Error deleting shape: ${res.statusText}`)
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

    // Create test tables in PostgreSQL if they don't exist
    await pgClient.query(`
      CREATE TABLE IF NOT EXISTS todo (
        id SERIAL PRIMARY KEY,
        task TEXT,
        done BOOLEAN
      );
    `)

    // Create additional tables needed for tests
    await pgClient.query(`
      CREATE TABLE IF NOT EXISTS project (
        id SERIAL PRIMARY KEY,
        name TEXT,
        active BOOLEAN
      );
    `)

    await pgClient.query(`
      CREATE TABLE IF NOT EXISTS alt_todo (
        id SERIAL PRIMARY KEY,
        task TEXT,
        done BOOLEAN
      );
    `)

    await pgClient.query(`
      CREATE TABLE IF NOT EXISTS test_syncing (
        id TEXT PRIMARY KEY,
        value TEXT,
        is_syncing BOOLEAN
      );
    `)

    // Create or replace the trigger function
    await pgClient.query(`
      CREATE OR REPLACE FUNCTION check_syncing()
      RETURNS TRIGGER AS $$
      DECLARE
        is_syncing BOOLEAN;
      BEGIN
        is_syncing := COALESCE(current_setting('electric.syncing', true)::boolean, false);
        IF is_syncing THEN
          NEW.is_syncing := TRUE;
        ELSE
          NEW.is_syncing := FALSE;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `)

    // Drop and recreate the trigger
    await pgClient.query(
      `DROP TRIGGER IF EXISTS test_syncing_trigger ON test_syncing;`,
    )
    await pgClient.query(`
      CREATE TRIGGER test_syncing_trigger
      BEFORE INSERT ON test_syncing
      FOR EACH ROW EXECUTE FUNCTION check_syncing();
    `)

    // Create a todo_alt table for the multiple subscriptions test
    await pgClient.query(`
      CREATE TABLE IF NOT EXISTS todo_alt (
        id SERIAL PRIMARY KEY,
        task TEXT,
        done BOOLEAN
      );
    `)

    // Clean up any existing data
    await pgClient.query(
      'TRUNCATE todo, project, alt_todo, test_syncing, todo_alt;',
    )
  })

  afterAll(async () => {
    // Truncate all tables
    await pgClient.query(
      'TRUNCATE todo, project, alt_todo, test_syncing, todo_alt;',
    )

    await pgClient.end()
    await deleteAllShapes()
  })

  beforeEach(async () => {
    await pgClient.query(
      'TRUNCATE todo, project, alt_todo, test_syncing, todo_alt;',
    )

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

    // Create additional tables needed for tests
    await pg.exec(`
      CREATE TABLE project (
        id SERIAL PRIMARY KEY,
        name TEXT,
        active BOOLEAN
      );
    `)

    await pg.exec(`
      CREATE TABLE alt_todo (
        id SERIAL PRIMARY KEY,
        task TEXT,
        done BOOLEAN
      );
    `)

    await pg.exec(`
      CREATE TABLE test_syncing (
        id TEXT PRIMARY KEY,
        value TEXT,
        is_syncing BOOLEAN
      );

      CREATE OR REPLACE FUNCTION check_syncing()
      RETURNS TRIGGER AS $$
      DECLARE
        is_syncing BOOLEAN;
      BEGIN
        is_syncing := COALESCE(current_setting('electric.syncing', true)::boolean, false);
        IF is_syncing THEN
          NEW.is_syncing := TRUE;
        ELSE
          NEW.is_syncing := FALSE;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      CREATE TRIGGER test_syncing_trigger
      BEFORE INSERT ON test_syncing
      FOR EACH ROW EXECUTE FUNCTION check_syncing();
    `)

    // Create a todo_alt table for the multiple subscriptions test
    await pg.exec(`
      CREATE TABLE todo_alt (
        id SERIAL PRIMARY KEY,
        task TEXT,
        done BOOLEAN
      );
    `)
  })

  afterEach(async () => {
    await pg.close()
    await deleteAllShapes()

    // Truncate all tables
    await pgClient.query(
      'TRUNCATE todo, project, alt_todo, test_syncing, todo_alt;',
    )
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
    await vi.waitFor(
      async () => {
        const result = await pg.sql`SELECT * FROM todo;`
        expect(result.rows).toEqual([
          {
            id: 1,
            task: 'task1',
            done: false,
          },
        ])
      },
      { timeout: 5000 },
    )

    // Update data in PostgreSQL
    await pgClient.query(`
      UPDATE todo SET task = 'task2', done = true WHERE id = 1;
    `)

    // Wait for sync to complete
    await vi.waitFor(
      async () => {
        const result = await pg.sql`SELECT * FROM todo;`
        expect(result.rows).toEqual([
          {
            id: 1,
            task: 'task2',
            done: true,
          },
        ])
      },
      { timeout: 5000 },
    )

    // Delete data in PostgreSQL
    await pgClient.query(`
      DELETE FROM todo WHERE id = 1;
    `)

    // Wait for sync to complete
    await vi.waitFor(
      async () => {
        const result = await pg.sql`SELECT * FROM todo;`
        expect(result.rows).toEqual([])
      },
      { timeout: 5000 },
    )

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

  it('syncs multiple shapes to multiple tables simultaneously', async () => {
    // Clean up any existing data in the project table
    await pgClient.query('TRUNCATE project;')
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
  })

  it('handles an update message with no columns to update', async () => {
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

    // Update data in PostgreSQL with only the primary key (no other columns)
    await pgClient.query(`
      UPDATE todo SET id = 1 WHERE id = 1;
    `)

    // Wait a moment to ensure sync has time to process
    await new Promise((resolve) => setTimeout(resolve, 1000))

    // Verify data remains unchanged
    const result = await pg.sql`SELECT * FROM todo;`
    expect(result.rows).toEqual([
      {
        id: 1,
        task: 'task1',
        done: false,
      },
    ])

    shape.unsubscribe()
  })

  it('sets the syncing flag to true when syncing begins', async () => {
    // Check the flag is not set outside of a sync
    const result0 =
      await pg.sql`SELECT current_setting('electric.syncing', true)`
    expect(result0.rows[0]).toEqual({ current_setting: null }) // not set yet as syncShapeToTable hasn't been called

    const shape = await pg.electric.syncShapeToTable({
      shape: {
        url: ELECTRIC_URL,
        params: { table: 'test_syncing' },
        fetchClient,
      },
      table: 'test_syncing',
      primaryKey: ['id'],
      shapeKey: null,
    })

    // Insert data into PostgreSQL
    await pgClient.query(`
      INSERT INTO test_syncing (id, value) 
      VALUES ('id1', 'test value');
    `)

    // Wait for sync to complete
    await vi.waitFor(async () => {
      const result = await pg.sql`SELECT * FROM test_syncing WHERE id = 'id1'`
      expect(result.rows).toHaveLength(1)
    })

    // Check the syncing flag was set during sync
    const result = await pg.sql`SELECT * FROM test_syncing WHERE id = 'id1'`
    expect(result.rows[0]).toEqual({
      id: 'id1',
      value: 'test value',
      is_syncing: true,
    })

    // Check the flag is not set outside of a sync
    const result2 =
      await pg.sql`SELECT current_setting('electric.syncing', true)`
    expect(result2.rows[0]).toEqual({ current_setting: 'false' })

    // Clean up
    shape.unsubscribe()
  })

  it('forbids multiple subscriptions to the same table', async () => {
    const table = 'todo'
    const altTable = 'alt_todo'

    // First subscription
    const shape1 = await pg.electric.syncShapeToTable({
      shape: {
        url: ELECTRIC_URL,
        params: { table },
        fetchClient,
      },
      table,
      primaryKey: ['id'],
      shapeKey: null,
    })

    // Should throw if syncing more shapes into same table
    await expect(
      async () =>
        await pg.electric.syncShapeToTable({
          shape: {
            url: ELECTRIC_URL,
            params: { table: 'todo_alt' },
            fetchClient,
          },
          table,
          primaryKey: ['id'],
          shapeKey: null,
        }),
    ).rejects.toThrowError(`Already syncing shape for table ${table}`)

    // Should be able to sync shape into other table
    const altShape = await pg.electric.syncShapeToTable({
      shape: {
        url: ELECTRIC_URL,
        params: { table: altTable },
        fetchClient,
      },
      table: altTable,
      primaryKey: ['id'],
      shapeKey: null,
    })

    // Clean up first subscription
    shape1.unsubscribe()

    // Should be able to sync different shape if previous is unsubscribed
    const shape2 = await pg.electric.syncShapeToTable({
      shape: {
        url: ELECTRIC_URL,
        params: { table: 'todo_alt' },
        fetchClient,
      },
      table,
      primaryKey: ['id'],
      shapeKey: null,
    })

    // Clean up
    altShape.unsubscribe()
    shape2.unsubscribe()
  })

  it('uses COPY FROM for initial batch of inserts', async () => {
    // Insert a large batch of records to test COPY FROM behavior
    const numInserts = 1000
    const values = Array.from(
      { length: numInserts },
      (_, idx) => `(${idx}, 'task${idx}', ${idx % 2 === 0})`,
    ).join(', ')
    await pgClient.query(`
      INSERT INTO todo (id, task, done) 
      VALUES ${values};
    `)

    const shape = await pg.electric.syncShapeToTable({
      shape: {
        url: ELECTRIC_URL,
        params: { table: 'todo' },
        fetchClient,
      },
      table: 'todo',
      primaryKey: ['id'],
      useCopy: true,
      shapeKey: null,
    })

    // Wait for all inserts to be synced
    await vi.waitFor(
      async () => {
        const result = await pg.sql<{
          count: number
        }>`SELECT COUNT(*) as count FROM todo;`
        expect(result.rows[0].count).toBe(numInserts)
      },
      { timeout: 20000 }, // Increase timeout for larger batch
    )

    // Verify some sample data
    const sampleResult = await pg.sql`
      SELECT * FROM todo ORDER BY id LIMIT 5;
    `
    expect(sampleResult.rows).toEqual([
      { id: 0, task: 'task0', done: true },
      { id: 1, task: 'task1', done: false },
      { id: 2, task: 'task2', done: true },
      { id: 3, task: 'task3', done: false },
      { id: 4, task: 'task4', done: true },
    ])

    // Update one record to verify updates still work after COPY
    await pgClient.query(`
      UPDATE todo SET task = 'updated task' WHERE id = 0;
    `)

    // Wait for update to sync
    await vi.waitFor(
      async () => {
        const result = await pg.sql`SELECT * FROM todo WHERE id = 0;`
        expect(result.rows[0]).toEqual({
          id: 0,
          task: 'updated task',
          done: true,
        })
      },
      { timeout: 5000 },
    )

    shape.unsubscribe()
  })

  it('handles special characters in COPY FROM data', async () => {
    // Insert records with special characters
    await pgClient.query(`
      INSERT INTO todo (id, task, done) VALUES
      (1, 'task with, comma', false),
      (2, 'task with "quotes"', true),
      (3, 'task with
newline', false);
    `)

    const shape = await pg.electric.syncShapeToTable({
      shape: {
        url: ELECTRIC_URL,
        params: { table: 'todo' },
        fetchClient,
      },
      table: 'todo',
      primaryKey: ['id'],
      useCopy: true,
      shapeKey: null,
    })

    // Wait for inserts to complete
    await vi.waitFor(
      async () => {
        const result = await pg.sql<{ count: number }>`
        SELECT COUNT(*) as count FROM todo;
      `
        expect(result.rows[0].count).toBe(3)
      },
      { timeout: 5000 },
    )

    // Verify the data was inserted correctly with special characters preserved
    const result = await pg.sql`
      SELECT * FROM todo ORDER BY id;
    `
    expect(result.rows).toEqual([
      { id: 1, task: 'task with, comma', done: false },
      { id: 2, task: 'task with "quotes"', done: true },
      { id: 3, task: 'task with\nnewline', done: false },
    ])

    shape.unsubscribe()
  })

  it('calls onInitialSync callback after initial sync', async () => {
    let callbackCalled = false
    const onInitialSync = () => {
      callbackCalled = true
    }

    const shape = await pg.electric.syncShapeToTable({
      shape: {
        url: ELECTRIC_URL,
        params: { table: 'todo' },
        fetchClient,
      },
      table: 'todo',
      primaryKey: ['id'],
      onInitialSync,
      shapeKey: null,
    })

    // Insert some initial data
    await pgClient.query(`
      INSERT INTO todo (id, task, done) VALUES
      (1, 'task1', false),
      (2, 'task2', true);
    `)

    // Wait for initial sync to complete
    await vi.waitFor(
      async () => {
        const result = await pg.sql<{ count: number }>`
        SELECT COUNT(*) as count FROM todo;
      `
        return result.rows[0].count === 2
      },
      { timeout: 5000 },
    )

    // Verify callback was called
    await vi.waitFor(
      () => {
        expect(callbackCalled).toBe(true)
        return callbackCalled === true
      },
      { timeout: 5000 },
    )

    // Insert more data - callback should not be called again
    callbackCalled = false
    await pgClient.query(`
      INSERT INTO todo (id, task, done) VALUES
      (3, 'task3', false);
    `)

    // Wait for sync to complete
    await vi.waitFor(
      async () => {
        const result = await pg.sql<{ count: number }>`
        SELECT COUNT(*) as count FROM todo;
      `
        return result.rows[0].count === 3
      },
      { timeout: 5000 },
    )

    // Verify callback was not called again
    expect(callbackCalled).toBe(false)

    shape.unsubscribe()
  })

  it('uses the specified metadata schema for subscription metadata', async () => {
    // Close the default PGlite instance
    await pg.close()

    // Create a new PGlite instance with a custom metadata schema
    const metadataSchema = 'custom_metadata'
    pg = await PGlite.create({
      extensions: {
        electric: electricSync({
          metadataSchema,
        }),
      },
    })

    // Initialize metadata tables
    await pg.electric.initMetadataTables()

    // Create the todo table
    await pg.exec(`
      CREATE TABLE todo (
        id SERIAL PRIMARY KEY,
        task TEXT,
        done BOOLEAN
      );
    `)

    // Verify the custom schema was created
    const schemaResult = await pg.query(
      `SELECT schema_name FROM information_schema.schemata WHERE schema_name = $1`,
      [metadataSchema],
    )
    expect(schemaResult.rows).toHaveLength(1)
    expect(schemaResult.rows[0]).toEqual({ schema_name: metadataSchema })

    // Verify the subscription table exists in the custom schema
    const tableResult = await pg.query(
      `SELECT table_name FROM information_schema.tables 
       WHERE table_schema = $1 AND table_name = 'subscriptions_metadata'`,
      [metadataSchema],
    )
    expect(tableResult.rows).toHaveLength(1)
    expect(tableResult.rows[0]).toEqual({
      table_name: 'subscriptions_metadata',
    })

    // Test that we can create a subscription with the custom schema
    const shape = await pg.electric.syncShapeToTable({
      shape: {
        url: ELECTRIC_URL,
        params: { table: 'todo' },
        fetchClient,
      },
      table: 'todo',
      primaryKey: ['id'],
      shapeKey: 'custom_schema_test',
    })

    // We don't persist any metadata untill some data has been synced
    await pgClient.query(`
      INSERT INTO todo (id, task, done) VALUES
      (1, 'task1', false);
    `)
    await vi.waitFor(
      async () => {
        const result = await pg.sql<{ count: number }>`
        SELECT COUNT(*) as count FROM todo;
      `
        expect(result.rows[0].count).toBe(1)
      },
      { timeout: 5000 },
    )

    // Check the data was inserted into the todo table
    const todoResult = await pg.sql`SELECT * FROM todo WHERE id = 1;`
    expect(todoResult.rows[0]).toEqual({
      id: 1,
      task: 'task1',
      done: false,
    })

    // Verify the subscription was stored in the custom schema
    const subscriptionResult = await pg.query(
      `SELECT * FROM ${metadataSchema}.subscriptions_metadata WHERE key = $1`,
      ['custom_schema_test'],
    )
    expect(subscriptionResult.rows).toHaveLength(1)

    // Clean up
    shape.unsubscribe()
    await pg.electric.deleteSubscription('custom_schema_test')
  })

  it('handles transactions across multiple tables with syncShapesToTables', async () => {
    // Clean up any existing data in the project table
    await pgClient.query('TRUNCATE project;')
    await pg.exec('TRUNCATE project;')

    // Set up sync for both tables using syncShapesToTables
    const syncResult = await pg.electric.syncShapesToTables({
      key: 'transaction_test',
      shapes: {
        todo_shape: {
          shape: {
            url: ELECTRIC_URL,
            params: { table: 'todo' },
            fetchClient,
          },
          table: 'todo',
          primaryKey: ['id'],
        },
        project_shape: {
          shape: {
            url: ELECTRIC_URL,
            params: { table: 'project' },
            fetchClient,
          },
          table: 'project',
          primaryKey: ['id'],
        },
      },
    })

    // Insert initial data in a transaction
    await pgClient.query('BEGIN;')
    await pgClient.query(`
      INSERT INTO todo (id, task, done) 
      VALUES (1, 'Initial task', false);
    `)
    await pgClient.query(`
      INSERT INTO project (id, name, active) 
      VALUES (1, 'Initial project', true);
    `)
    await pgClient.query('COMMIT;')

    // Wait for both inserts to be synced
    await vi.waitFor(
      async () => {
        const todoCount = await pg.sql<{
          count: number
        }>`SELECT COUNT(*) as count FROM todo;`
        const projectCount = await pg.sql<{
          count: number
        }>`SELECT COUNT(*) as count FROM project;`
        expect(todoCount.rows[0].count).toBe(1)
        expect(projectCount.rows[0].count).toBe(1)
      },
      { timeout: 5000 },
    )

    // Verify initial data was inserted
    const todoResult = await pg.sql`SELECT * FROM todo WHERE id = 1;`
    expect(todoResult.rows[0]).toEqual({
      id: 1,
      task: 'Initial task',
      done: false,
    })

    const projectResult = await pg.sql`SELECT * FROM project WHERE id = 1;`
    expect(projectResult.rows[0]).toEqual({
      id: 1,
      name: 'Initial project',
      active: true,
    })

    // Update both tables in a transaction
    await pgClient.query('BEGIN;')
    await pgClient.query(`
      UPDATE todo SET task = 'Updated in transaction', done = true WHERE id = 1;
    `)
    await pgClient.query(`
      UPDATE project SET name = 'Updated in transaction', active = false WHERE id = 1;
    `)
    await pgClient.query('COMMIT;')

    // Wait for both updates to be synced
    await vi.waitFor(
      async () => {
        const todoResult = await pg.sql<{
          id: number
          task: string
          done: boolean
        }>`SELECT * FROM todo WHERE id = 1;`
        const projectResult = await pg.sql<{
          id: number
          name: string
          active: boolean
        }>`SELECT * FROM project WHERE id = 1;`
        expect(todoResult.rows[0].task).toBe('Updated in transaction')
        expect(projectResult.rows[0].name).toBe('Updated in transaction')
      },
      { timeout: 5000 },
    )

    // Verify both updates were applied
    const updatedTodoResult = await pg.sql`SELECT * FROM todo WHERE id = 1;`
    expect(updatedTodoResult.rows[0]).toEqual({
      id: 1,
      task: 'Updated in transaction',
      done: true,
    })

    const updatedProjectResult =
      await pg.sql`SELECT * FROM project WHERE id = 1;`
    expect(updatedProjectResult.rows[0]).toEqual({
      id: 1,
      name: 'Updated in transaction',
      active: false,
    })

    // Clean up
    syncResult.unsubscribe()
  })

  it('stops sync after unsubscribe', async () => {
    // First sync session with a persistent key
    let shape = await pg.electric.syncShapeToTable({
      shape: {
        url: ELECTRIC_URL,
        params: { table: 'todo' },
        fetchClient,
      },
      table: 'todo',
      primaryKey: ['id'],
      shapeKey: 'refetch_test',
    })

    // Insert initial batch of data
    await pgClient.query(`
      INSERT INTO todo (id, task, done) 
      VALUES (1, 'Initial task', false);
    `)

    // Wait 3 seconds to make sure the data is synced
    await new Promise((resolve) => setTimeout(resolve, 3000))

    // Wait for initial sync to complete
    await vi.waitFor(async () => {
      const result = await pg.sql<{
        count: number
      }>`SELECT COUNT(*) as count FROM todo;`
      expect(result.rows[0].count).toBe(1)
    })

    // Check the data was inserted into the todo table
    const todoResult = await pg.sql`SELECT * FROM todo WHERE id = 1;`
    expect(todoResult.rows[0]).toEqual({
      id: 1,
      task: 'Initial task',
      done: false,
    })

    // Unsubscribe from first sync session
    shape.unsubscribe()

    // Insert new data before we resume the sync
    await pgClient.query(`
      INSERT INTO todo (id, task, done) 
      VALUES (2, 'New task after refetch', true);
    `)

    // Wait for sync to complete
    await vi.waitFor(
      async () => {
        const result = await pg.sql<{
          count: number
        }>`SELECT COUNT(*) as count FROM todo;`
        expect(result.rows[0].count).not.toBe(2)
      },
      { timeout: 5000 },
    )

    // Verify only the new data is present (old data was cleared)
    const result = await pg.sql`SELECT * FROM todo ORDER BY id;`
    expect(result.rows).toEqual([
      {
        id: 1,
        task: 'Initial task',
        done: false,
      },
    ])

    // Clean up
    shape.unsubscribe()
    await pg.electric.deleteSubscription('refetch_test')
  })

  it('resumes sync after unsubscribe', async () => {
    // First sync session with a persistent key
    let shape = await pg.electric.syncShapeToTable({
      shape: {
        url: ELECTRIC_URL,
        params: { table: 'todo' },
        fetchClient,
      },
      table: 'todo',
      primaryKey: ['id'],
      shapeKey: 'refetch_test',
    })

    // Insert initial batch of data
    await pgClient.query(`
      INSERT INTO todo (id, task, done) 
      VALUES (1, 'Initial task', false);
    `)

    // Wait for initial sync to complete
    await vi.waitFor(async () => {
      const result = await pg.sql<{
        count: number
      }>`SELECT COUNT(*) as count FROM todo;`
      expect(result.rows[0].count).toBe(1)
    })

    // Check the data was inserted into the todo table
    const todoResult = await pg.sql`SELECT * FROM todo WHERE id = 1;`
    expect(todoResult.rows[0]).toEqual({
      id: 1,
      task: 'Initial task',
      done: false,
    })

    // Unsubscribe from first sync session
    shape.unsubscribe()

    // Insert new data before we resume the sync
    await pgClient.query(`
      INSERT INTO todo (id, task, done) 
      VALUES (2, 'New task after refetch', true);
    `)

    // Start a new sync session with the same key
    shape = await pg.electric.syncShapeToTable({
      shape: {
        url: ELECTRIC_URL,
        params: { table: 'todo' },
        fetchClient,
      },
      table: 'todo',
      primaryKey: ['id'],
      shapeKey: 'refetch_test',
    })

    // Wait for sync to complete
    await vi.waitFor(
      async () => {
        const result = await pg.sql<{
          count: number
        }>`SELECT COUNT(*) as count FROM todo;`
        expect(result.rows[0].count).toBe(2)
      },
      { timeout: 5000 },
    )

    // Verify only the new data is present (old data was cleared)
    const result = await pg.sql`SELECT * FROM todo ORDER BY id;`
    expect(result.rows).toEqual([
      {
        id: 1,
        task: 'Initial task',
        done: false,
      },
      {
        id: 2,
        task: 'New task after refetch',
        done: true,
      },
    ])

    // Clean up
    shape.unsubscribe()
    await pg.electric.deleteSubscription('refetch_test')
  })

  it('clears and restarts persisted shape stream state on refetch', async () => {
    // First sync session with a persistent key
    let shape = await pg.electric.syncShapeToTable({
      shape: {
        url: ELECTRIC_URL,
        params: { table: 'todo' },
        fetchClient,
      },
      table: 'todo',
      primaryKey: ['id'],
      shapeKey: 'refetch_test',
    })

    // Insert initial batch of data
    await pgClient.query(`
      INSERT INTO todo (id, task, done) 
      VALUES (1, 'Initial task', false);
    `)

    // Wait for initial sync to complete
    await vi.waitFor(async () => {
      const result = await pg.sql<{
        count: number
      }>`SELECT COUNT(*) as count FROM todo;`
      expect(result.rows[0].count).toBe(1)
    })

    // Check the data was inserted into the todo table
    const todoResult = await pg.sql`SELECT * FROM todo WHERE id = 1;`
    expect(todoResult.rows[0]).toEqual({
      id: 1,
      task: 'Initial task',
      done: false,
    })

    // Unsubscribe from first sync session
    shape.unsubscribe()

    // Delete the shape on the server to force a refetch
    await deleteAllShapes()

    // Insert new data before we resume the sync
    await pgClient.query(`
      INSERT INTO todo (id, task, done) 
      VALUES (2, 'New task after refetch', true);
    `)

    // Start a new sync session with the same key
    shape = await pg.electric.syncShapeToTable({
      shape: {
        url: ELECTRIC_URL,
        params: { table: 'todo' },
        fetchClient,
      },
      table: 'todo',
      primaryKey: ['id'],
      shapeKey: 'refetch_test',
    })

    // Wait for sync to complete
    await vi.waitFor(
      async () => {
        const result = await pg.sql<{
          count: number
        }>`SELECT COUNT(*) as count FROM todo;`
        expect(result.rows[0].count).toBe(2)
      },
      { timeout: 5000 },
    )

    // Verify only the new data is present (old data was cleared)
    const result = await pg.sql`SELECT * FROM todo ORDER BY id;`
    expect(result.rows).toEqual([
      {
        id: 1,
        task: 'Initial task',
        done: false,
      },
      {
        id: 2,
        task: 'New task after refetch',
        done: true,
      },
    ])

    // Clean up
    shape.unsubscribe()
    await pg.electric.deleteSubscription('refetch_test')
  })

  it('handles must-refetch control message across multiple tables', async () => {
    // Set up sync for both tables using syncShapesToTables
    const syncResult = await pg.electric.syncShapesToTables({
      key: 'refetch_multi_test',
      shapes: {
        todo_shape: {
          shape: {
            url: ELECTRIC_URL,
            params: { table: 'todo' },
            fetchClient,
          },
          table: 'todo',
          primaryKey: ['id'],
        },
        project_shape: {
          shape: {
            url: ELECTRIC_URL,
            params: { table: 'project' },
            fetchClient,
          },
          table: 'project',
          primaryKey: ['id'],
        },
      },
    })

    // Insert initial data
    await pgClient.query(`
      INSERT INTO todo (id, task, done) 
      VALUES (1, 'Initial todo', false);
    `)
    await pgClient.query(`
      INSERT INTO project (id, name, active) 
      VALUES (1, 'Initial project', true);
    `)

    // Wait for initial sync to complete
    await vi.waitFor(
      async () => {
        const todoCount = await pg.sql<{
          count: number
        }>`SELECT COUNT(*) as count FROM todo;`
        const projectCount = await pg.sql<{
          count: number
        }>`SELECT COUNT(*) as count FROM project;`
        return todoCount.rows[0].count === 1 && projectCount.rows[0].count === 1
      },
      { timeout: 5000 },
    )

    // Unsubscribe from sync
    syncResult.unsubscribe()

    // Delete the shapes on the server to force a refetch
    await deleteAllShapesForTable('todo')
    // we don't need to delete the project shape so we can test a must-refetch on
    // just one of the tables

    // Insert new data after refetch
    await pgClient.query(`
      INSERT INTO todo (id, task, done) 
      VALUES (2, 'New todo after refetch', true);
    `)
    await pgClient.query(`
      INSERT INTO project (id, name, active) 
      VALUES (2, 'New project after refetch', false);
    `)

    // Start a new sync session with the same key
    const newSyncResult = await pg.electric.syncShapesToTables({
      key: 'refetch_multi_test',
      shapes: {
        todo_shape: {
          shape: {
            url: ELECTRIC_URL,
            params: { table: 'todo' },
            fetchClient,
          },
          table: 'todo',
          primaryKey: ['id'],
        },
        project_shape: {
          shape: {
            url: ELECTRIC_URL,
            params: { table: 'project' },
            fetchClient,
          },
          table: 'project',
          primaryKey: ['id'],
        },
      },
    })

    // Wait for sync to complete
    await vi.waitFor(
      async () => {
        const todoCount = await pg.sql<{
          count: number
        }>`SELECT COUNT(*) as count FROM todo;`
        const projectCount = await pg.sql<{
          count: number
        }>`SELECT COUNT(*) as count FROM project;`
        expect(todoCount.rows[0].count).toBe(2)
        expect(projectCount.rows[0].count).toBe(2)
      },
      { timeout: 5000 },
    )

    // Verify only the new data is present (old data was cleared)
    const todoResult = await pg.sql`SELECT * FROM todo ORDER BY id;`
    expect(todoResult.rows).toEqual([
      {
        id: 1,
        task: 'Initial todo',
        done: false,
      },
      {
        id: 2,
        task: 'New todo after refetch',
        done: true,
      },
    ])

    const projectResult = await pg.sql`SELECT * FROM project ORDER BY id;`
    expect(projectResult.rows).toEqual([
      {
        id: 1,
        name: 'Initial project',
        active: true,
      },
      {
        id: 2,
        name: 'New project after refetch',
        active: false,
      },
    ])

    // Clean up
    newSyncResult.unsubscribe()
    await pg.electric.deleteSubscription('refetch_multi_test')
  })
})
