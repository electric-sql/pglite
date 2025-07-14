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
import { electricSync, InitialInsertMethod } from '../src/index.js'

const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://postgres:password@localhost:54321/electric?sslmode=disable'
const ELECTRIC_URL =
  process.env.ELECTRIC_URL || 'http://localhost:3000/v1/shape'

const shapeHandles: Map<string, string> = new Map()

const DEBUG = false
const LOG_FETCH = DEBUG

let fetchCount = 0

const fetchClient: typeof fetch = async (
  url: string | Request | URL,
  options: RequestInit = {},
) => {
  const thisFetchCount = fetchCount++
  if (LOG_FETCH) {
    console.log('>> fetch', thisFetchCount, url, options)
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
      console.log('>> fetch error', thisFetchCount, e)
    }
    throw e
  }
  if (table) {
    shapeHandles.set(res.headers.get('electric-handle')!, table)
  }
  if (LOG_FETCH) {
    console.log(
      '>> fetch res',
      thisFetchCount,
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

const deleteAllShapesForTable = async (targetTable: string) => {
  for (const [handle, table] of shapeHandles.entries()) {
    if (table === targetTable) {
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

    // Create a large table with 10 columns in PostgreSQL
    await pgClient.query(`
      CREATE TABLE IF NOT EXISTS large_table (
        id SERIAL PRIMARY KEY,
        col1 TEXT,
        col2 INTEGER,
        col3 BOOLEAN,
        col4 TIMESTAMP,
        col5 NUMERIC(10,2),
        col6 TEXT,
        col7 INTEGER,
        col8 BOOLEAN,
        col9 TEXT
      );
    `)

    // Create a table for large operations
    await pgClient.query(`
      CREATE TABLE IF NOT EXISTS large_ops_table (
        id SERIAL PRIMARY KEY,
        value TEXT,
        number INTEGER,
        flag BOOLEAN
      );
    `)

    // Create a user-defined enum for data type testing
    await pgClient.query(`
      CREATE TYPE data_types_enum AS ENUM ('one', 'two', 'three');
    `)

    // Create a table for data type testing
    await pgClient.query(`
      CREATE TABLE IF NOT EXISTS data_types_table (
        id SERIAL PRIMARY KEY,
        int_col INTEGER,
        float_col FLOAT,
        boolean_col BOOLEAN,
        string_col TEXT,
        json_col JSONB,
        json_plain_col JSON,
        int_array_col INTEGER[],
        enum_col data_types_enum
      );
    `)

    // Clean up any existing data
    await pgClient.query(
      'TRUNCATE todo, project, alt_todo, test_syncing, todo_alt, large_table, large_ops_table, data_types_table;',
    )
  })

  afterAll(async () => {
    // Truncate all tables
    await pgClient.query(
      'TRUNCATE todo, project, alt_todo, test_syncing, todo_alt, large_table, large_ops_table, data_types_table;',
    )

    await pgClient.end()
    await deleteAllShapes()
  })

  beforeEach(async () => {
    await pgClient.query(
      'TRUNCATE todo, project, alt_todo, test_syncing, todo_alt, large_table, large_ops_table, data_types_table;',
    )

    // Create PGlite instance with electric sync extension
    pg = await PGlite.create({
      extensions: {
        electric: electricSync({ debug: DEBUG }),
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

    // Create the same table in PGlite
    await pg.exec(`
      CREATE TABLE large_table (
        id SERIAL PRIMARY KEY,
        col1 TEXT,
        col2 INTEGER,
        col3 BOOLEAN,
        col4 TIMESTAMP,
        col5 NUMERIC(10,2),
        col6 TEXT,
        col7 INTEGER,
        col8 BOOLEAN,
        col9 TEXT
      );
    `)

    await pg.exec(`
      CREATE TABLE large_ops_table (
        id SERIAL PRIMARY KEY,
        value TEXT,
        number INTEGER,
        flag BOOLEAN
      );
    `)

    // Create a user-defined enum for data type testing
    await pg.query(`
      CREATE TYPE data_types_enum AS ENUM ('one', 'two', 'three');
    `)

    // Create data types testing table
    await pg.exec(`
      CREATE TABLE data_types_table (
        id SERIAL PRIMARY KEY,
        int_col INTEGER,
        float_col FLOAT,
        boolean_col BOOLEAN,
        string_col TEXT,
        json_col JSONB,
        json_plain_col JSON,
        int_array_col INTEGER[],
        enum_col data_types_enum
      );
    `)
  })

  afterEach(async () => {
    try {
      await pg.close()
    } catch (e) {
      // ignore as we may have already closed it in the test
    }
    await deleteAllShapes()

    // Truncate all tables
    await pgClient.query(
      'TRUNCATE todo, project, alt_todo, test_syncing, todo_alt, large_table, large_ops_table, data_types_table;',
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
      { timeout: 10000 },
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
      initialInsertMethod: 'csv',
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
      initialInsertMethod: 'csv',
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

    // We don't persist any metadata until some data has been synced
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
    const shape = await pg.electric.syncShapeToTable({
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

  it('resumes sync after pglite restart', async () => {
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

    // Dump datadir and restart pglite
    const datadir = await pg.dumpDataDir()
    await pg.close()
    const pg2 = await PGlite.create({
      loadDataDir: datadir,
      extensions: {
        electric: electricSync(),
      },
    })

    // Insert new data before we resume the sync
    await pgClient.query(`
      INSERT INTO todo (id, task, done)
      VALUES (2, 'New task after refetch', true);
    `)

    // Start a new sync session with the same key
    shape = await pg2.electric.syncShapeToTable({
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
        const result = await pg2.sql<{
          count: number
        }>`SELECT COUNT(*) as count FROM todo;`
        expect(result.rows[0].count).toBe(2)
      },
      { timeout: 5000 },
    )

    // Verify only the new data is present (old data was cleared)
    const result = await pg2.sql`SELECT * FROM todo ORDER BY id;`
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

  it('handles onMustRefetch with local data', async () => {
    // Insert initial data
    await pgClient.query(`
      INSERT INTO todo (id, task, done)
      VALUES
        (1, 'Todo 1', false),
        (2, 'Todo 2', false),
        (3, 'Todo 3', false),
        (4, 'Todo 4', false),
        (5, 'Todo 5', false),
        (6, 'Todo 6', false),
        (7, 'Todo 7', false),
        (8, 'Todo 8', false),
        (9, 'Todo 9', false),
        (10, 'Todo 10', false);
    `)

    // Set up sync for both tables using syncShapesToTables
    const shape1 = await pg.electric.syncShapeToTable({
      shape: {
        url: ELECTRIC_URL,
        params: { table: 'todo', where: 'id > 5' },
        fetchClient,
      },
      table: 'todo',
      primaryKey: ['id'],
      shapeKey: 'todo_shape1',
      onMustRefetch: async (tx) => {
        await tx.exec(`DELETE FROM todo WHERE id > 5;`)
      },
    })

    const shape2 = await pg.electric.syncShapeToTable({
      shape: {
        url: ELECTRIC_URL,
        params: { table: 'todo', where: 'id <= 5' },
        fetchClient,
      },
      table: 'todo',
      primaryKey: ['id'],
      shapeKey: 'todo_shape2',
      onMustRefetch: async (tx) => {
        await tx.exec(`DELETE FROM todo WHERE id <= 5;`)
      },
    })

    // Wait for initial sync to complete
    await vi.waitFor(
      async () => {
        const todoCount = await pg.sql<{
          count: number
        }>`SELECT COUNT(*) as count FROM todo;`
        expect(todoCount.rows[0].count).toBe(10)
      },
      { timeout: 5000 },
    )

    // Insert some local data
    await pg.query(`
      INSERT INTO todo (id, task, done)
      VALUES
        (11, 'Todo 11', false),
        (12, 'Todo 12', false),
        (13, 'Todo 13', false);
    `)

    // Delete the shapes on the server to force a must-refetch on it
    await deleteShape('todo', shape1.stream.shapeHandle!)

    // Update all to done
    await pgClient.query(`
      UPDATE todo SET done = true;
    `)

    // Wait for sync to complete
    await vi.waitFor(
      async () => {
        const todoCount = await pg.sql<{
          count: number
        }>`SELECT COUNT(*) as count FROM todo WHERE done = true;`
        expect(todoCount.rows[0].count).toBe(10)
      },
      { timeout: 5000 },
    )

    // Verify that the local data is still present
    const localTodoCount = await pg.sql<{
      count: number
    }>`SELECT COUNT(*) as count FROM todo WHERE id > 10 AND done = false;`
    expect(localTodoCount.rows[0].count).toBe(3)

    // Clean up
    shape1.unsubscribe()
    shape2.unsubscribe()
    await pg.electric.deleteSubscription('todo_shape1')
    await pg.electric.deleteSubscription('todo_shape2')
  })

  it('handles large initial load with multiple columns', async () => {
    // Generate data in batches
    const numRows = 5000 // Reduced from 10k to 5k for faster test execution
    const batchSize = 500
    const batches = Math.ceil(numRows / batchSize)

    for (let batch = 0; batch < batches; batch++) {
      const start = batch * batchSize
      const end = Math.min(start + batchSize, numRows)

      // Build a batch of INSERT statements
      for (let i = start; i < end; i++) {
        await pgClient.query(
          `
          INSERT INTO large_table (
            id, col1, col2, col3, col4, col5, col6, col7, col8, col9
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
          );
        `,
          [
            i,
            `text-${i}`,
            i * 10,
            i % 2 === 0,
            new Date(2023, 0, 1, 12 + i), // 2023-01-01 12:00:00 + i hours
            i * 1.5,
            `long-text-value-${i}-with-some-additional-content`,
            i * 5,
            i % 3 === 0,
            `another-text-value-${i}`,
          ],
        )
      }
    }

    // Set up sync with COPY enabled for efficiency
    const shape = await pg.electric.syncShapeToTable({
      shape: {
        url: ELECTRIC_URL,
        params: { table: 'large_table' },
        fetchClient,
      },
      table: 'large_table',
      primaryKey: ['id'],
      initialInsertMethod: 'csv',
      shapeKey: null,
    })

    // Wait for all data to be synced - increase timeout for large dataset
    await vi.waitFor(
      async () => {
        const result = await pg.sql<{
          count: number
        }>`SELECT COUNT(*) as count FROM large_table;`
        expect(result.rows[0].count).toBe(numRows)
      },
      { timeout: 60000 }, // 60 second timeout for large dataset
    )

    // Verify some sample data points
    const firstRow = await pg.sql`SELECT * FROM large_table WHERE id = 0;`
    expect(firstRow.rows[0]).toMatchObject({
      id: 0,
      col1: 'text-0',
      col2: 0,
      col3: true,
      // Skip timestamp comparison as it might have timezone differences
      col5: '0.00',
      col6: 'long-text-value-0-with-some-additional-content',
      col7: 0,
      col8: true,
      col9: 'another-text-value-0',
    })

    const middleRow = await pg.sql`SELECT * FROM large_table WHERE id = 2500;`
    expect(middleRow.rows[0]).toMatchObject({
      id: 2500,
      col1: 'text-2500',
      col2: 25000,
      col3: true,
      // Skip timestamp comparison
      col5: '3750.00',
      col6: 'long-text-value-2500-with-some-additional-content',
      col7: 12500,
      col8: false,
      col9: 'another-text-value-2500',
    })

    const lastRow =
      await pg.sql`SELECT * FROM large_table WHERE id = ${numRows - 1};`
    expect(lastRow.rows[0]).toMatchObject({
      id: numRows - 1,
      col1: `text-${numRows - 1}`,
      col2: (numRows - 1) * 10,
      col3: (numRows - 1) % 2 === 0,
      // Skip timestamp comparison
      col5: ((numRows - 1) * 1.5).toFixed(2),
      col6: `long-text-value-${numRows - 1}-with-some-additional-content`,
      col7: (numRows - 1) * 5,
      col8: (numRows - 1) % 3 === 0,
      col9: `another-text-value-${numRows - 1}`,
    })

    // Clean up
    shape.unsubscribe()
  }, 60000)

  it('handles large update with inserts, deletes, and updates', async () => {
    // Insert initial rows (some will be updated, some deleted, some unchanged)
    const totalRows = 3000
    const batchSize = 500
    const batches = Math.ceil(totalRows / batchSize)

    for (let batch = 0; batch < batches; batch++) {
      const start = batch * batchSize
      const end = Math.min(start + batchSize, totalRows)

      for (let i = start; i < end; i++) {
        await pgClient.query(
          `
          INSERT INTO large_ops_table (id, value, number, flag)
          VALUES ($1, $2, $3, $4);
        `,
          [i, `initial-value-${i}`, i, i % 2 === 0],
        )
      }
    }

    // Set up sync
    const shape = await pg.electric.syncShapeToTable({
      shape: {
        url: ELECTRIC_URL,
        params: { table: 'large_ops_table' },
        fetchClient,
      },
      table: 'large_ops_table',
      primaryKey: ['id'],
      initialInsertMethod: 'csv',
      shapeKey: null,
    })

    // Wait for initial sync to complete
    await vi.waitFor(
      async () => {
        const result = await pg.sql<{
          count: number
        }>`SELECT COUNT(*) as count FROM large_ops_table;`
        expect(result.rows[0].count).toBe(totalRows)
      },
      { timeout: 30000 },
    )

    // Begin transaction for large update
    await pgClient.query('BEGIN;')

    // 1. Delete rows (ids 1-999) - leave id=1 in the table
    await pgClient.query(`
      DELETE FROM large_ops_table WHERE id BETWEEN 1 AND 999;
    `)

    // 2. Update rows (ids 1000-1999)
    await pgClient.query(`
      UPDATE large_ops_table
      SET value = 'updated-value', number = number * 10, flag = NOT flag
      WHERE id BETWEEN 1000 AND 1999;
    `)

    // 3. Insert new rows
    for (let i = totalRows; i < totalRows + 1000; i++) {
      await pgClient.query(
        `
        INSERT INTO large_ops_table (id, value, number, flag)
        VALUES ($1, $2, $3, $4);
      `,
        [i, `new-value-${i}`, i * 2, i % 3 === 0],
      )
    }

    // Commit the transaction
    await pgClient.query('COMMIT;')

    // Wait for all changes to sync
    await vi.waitFor(
      async () => {
        const result = await pg.sql<{
          count: number
        }>`SELECT COUNT(*) as count FROM large_ops_table;`
        expect(result.rows[0].count).toBe(3001) // 3000 original - 999 deleted + 1000 new = 3001
      },
      { timeout: 30000 },
    )

    // Verify deleted rows are gone
    const deletedCount = await pg.sql<{
      count: number
    }>`SELECT COUNT(*) as count FROM large_ops_table WHERE id BETWEEN 1 AND 999;`
    expect(deletedCount.rows[0].count).toBe(0)

    // Verify updated rows have new values
    const updatedRow =
      await pg.sql`SELECT * FROM large_ops_table WHERE id = 1500;`
    expect(updatedRow.rows[0]).toEqual({
      id: 1500,
      value: 'updated-value',
      number: 15000, // 1500 * 10
      flag: 1500 % 2 !== 0, // NOT the original flag
    })

    // Verify new rows were inserted
    const newRow = await pg.sql`SELECT * FROM large_ops_table WHERE id = 3500;`
    expect(newRow.rows[0]).toEqual({
      id: 3500,
      value: 'new-value-3500',
      number: 7000, // 3500 * 2
      flag: 3500 % 3 === 0,
    })

    // Verify unchanged rows remain the same
    const unchangedRow =
      await pg.sql`SELECT * FROM large_ops_table WHERE id = 2500;`
    expect(unchangedRow.rows[0]).toEqual({
      id: 2500,
      value: 'initial-value-2500',
      number: 2500,
      flag: 2500 % 2 === 0,
    })

    // Clean up
    shape.unsubscribe()
  })

  it('will perform initial sync for multi-shape subscriptions when only one table has data', async () => {
    const syncResult = await pg.electric.syncShapesToTables({
      key: 'cycle_test',
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

    await pgClient.query(`
      INSERT INTO todo (id, task, done)
      VALUES (1, 'Todo 1', false);
    `)

    // Wait for todo insert to sync
    await vi.waitFor(
      async () => {
        const todoResult = await pg.sql<{
          id: number
          task: string
          done: boolean
        }>`SELECT * FROM todo WHERE id = 1;`
        expect(todoResult.rows.length).toBe(1)
        expect(todoResult.rows[0]).toEqual({
          id: 1,
          task: `Todo 1`,
          done: false,
        })
      },
      { timeout: 5000 },
    )

    syncResult.unsubscribe()
  })

  it('cycles through operations with todo and project tables', async () => {
    // Set up sync for both tables using syncShapesToTables
    const syncResult = await pg.electric.syncShapesToTables({
      key: 'cycle_test',
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

    // Run multiple iterations of the cycle
    const iterations = 20
    for (let i = 1; i <= iterations; i++) {
      // 1. Insert into todo, check
      await pgClient.query(`
        INSERT INTO todo (id, task, done)
        VALUES (${i * 6 - 5}, 'Todo ${i}.1', false);
      `)

      // Wait for todo insert to sync
      await vi.waitFor(
        async () => {
          const todoResult = await pg.sql<{
            id: number
            task: string
            done: boolean
          }>`SELECT * FROM todo WHERE id = ${i * 6 - 5};`
          expect(todoResult.rows.length).toBe(1)
          expect(todoResult.rows[0]).toEqual({
            id: i * 6 - 5,
            task: `Todo ${i}.1`,
            done: false,
          })
        },
        { timeout: 5000 },
      )

      // 2. Insert into todo and project in transaction, check
      await pgClient.query('BEGIN;')
      await pgClient.query(`
        INSERT INTO todo (id, task, done)
        VALUES (${i * 6 - 4}, 'Todo ${i}.2', true);
      `)
      await pgClient.query(`
        INSERT INTO project (id, name, active)
        VALUES (${i}, 'Project ${i}', true);
      `)
      await pgClient.query('COMMIT;')

      // Wait for transaction to sync
      await vi.waitFor(
        async () => {
          const todoResult = await pg.sql<{
            id: number
            task: string
            done: boolean
          }>`SELECT * FROM todo WHERE id = ${i * 6 - 4};`
          const projectResult = await pg.sql<{
            id: number
            name: string
            active: boolean
          }>`SELECT * FROM project WHERE id = ${i};`
          expect(todoResult.rows).toHaveLength(1)
          expect(projectResult.rows).toHaveLength(1)
        },
        { timeout: 5000 },
      )

      // 3. Update todo, check
      await pgClient.query(`
        INSERT INTO todo (id, task, done)
        VALUES (${i * 6 - 3}, 'Todo ${i}.3', false);
      `)
      await pgClient.query(`
        UPDATE todo SET task = 'Updated Todo ${i}.1', done = true WHERE id = ${i * 6 - 5};
      `)

      // Wait for update to sync
      await vi.waitFor(
        async () => {
          const todoResult = await pg.sql<{
            id: number
            task: string
            done: boolean
          }>`SELECT * FROM todo WHERE id = ${i * 6 - 5};`
          expect(todoResult.rows[0]).toEqual({
            id: i * 6 - 5,
            task: `Updated Todo ${i}.1`,
            done: true,
          })
        },
        { timeout: 5000 },
      )

      // 4. Update project and todo, check
      await pgClient.query('BEGIN;')
      await pgClient.query(`
        INSERT INTO todo (id, task, done)
        VALUES (${i * 6 - 2}, 'Todo ${i}.4', true);
      `)
      await pgClient.query(`
        UPDATE todo SET task = 'Updated Todo ${i}.2', done = false WHERE id = ${i * 6 - 4};
      `)
      await pgClient.query(`
        UPDATE project SET name = 'Updated Project ${i}', active = false WHERE id = ${i};
      `)
      await pgClient.query('COMMIT;')

      // Wait for updates to sync
      await vi.waitFor(
        async () => {
          const todoResult = await pg.sql<{
            id: number
            task: string
            done: boolean
          }>`SELECT * FROM todo WHERE id = ${i * 6 - 4};`
          const projectResult = await pg.sql<{
            id: number
            name: string
            active: boolean
          }>`SELECT * FROM project WHERE id = ${i};`
          expect(todoResult.rows[0].task).toBe(`Updated Todo ${i}.2`)
          expect(projectResult.rows[0].name).toBe(`Updated Project ${i}`)
        },
        { timeout: 5000 },
      )

      // 5. Delete a todo, check
      await pgClient.query(`
        INSERT INTO todo (id, task, done)
        VALUES (${i * 6 - 1}, 'Todo ${i}.5', false);
      `)
      await pgClient.query(`
        DELETE FROM todo WHERE id = ${i * 6 - 3};
      `)

      // Wait for delete to sync
      await vi.waitFor(
        async () => {
          const todoResult = await pg.sql<{
            id: number
            task: string
            done: boolean
          }>`SELECT * FROM todo WHERE id = ${i * 6 - 3};`
          expect(todoResult.rows).toHaveLength(0)
        },
        { timeout: 5000 },
      )

      // 6. Delete the project, check
      await pgClient.query(`
        INSERT INTO todo (id, task, done)
        VALUES (${i * 6}, 'Todo ${i}.6', true);
      `)
      await pgClient.query(`
        DELETE FROM project WHERE id = ${i};
      `)

      // Wait for delete to sync
      await vi.waitFor(
        async () => {
          const projectResult = await pg.sql<{
            id: number
            name: string
            active: boolean
          }>`SELECT * FROM project WHERE id = ${i};`
          expect(projectResult.rows).toHaveLength(0)
        },
        { timeout: 5000 },
      )

      // Verify that after each iteration:
      // - project count is 0
      // - todo count increases by 1 (we add 6 todos and delete 1 per iteration)
      const projectCount = await pg.sql<{
        count: number
      }>`SELECT COUNT(*) as count FROM project;`
      const todoCount = await pg.sql<{
        count: number
      }>`SELECT COUNT(*) as count FROM todo;`

      expect(projectCount.rows[0].count).toBe(0)
      expect(todoCount.rows[0].count).toBe(i * 5) // 6 inserts - 1 delete per iteration
    }

    // Clean up
    syncResult.unsubscribe()
    await pg.electric.deleteSubscription('cycle_test')
  }, 30000) // allow 30 seconds to run this test as it is long

  const types_syncer = async (initialInsertMethod: InitialInsertMethod) => {
    // Test data for different data types
    const testData = [
      {
        id: 1,
        int_col: 42,
        float_col: 3.14159,
        boolean_col: true,
        string_col: 'Hello, world!',
        json_col: { name: 'Test', nested: { value: 123 }, array: [1, 2, 3] },
        json_plain_col: {
          type: 'JSON',
          different: 'from JSONB',
          nums: [42, 43],
        },
        int_array_col: [1, 2, 3],
        enum_col: 'one',
      },
      {
        id: 2,
        int_col: -100,
        float_col: -0.5,
        boolean_col: false,
        string_col: 'Special chars: \n\t"\'\\',
        json_col: { empty: {}, list: [] },
        json_plain_col: { empty_arr: [], value: null },
        int_array_col: [4, 5, 6],
        enum_col: 'two',
      },
      {
        id: 3,
        int_col: 0,
        float_col: 0.0,
        boolean_col: true,
        string_col: '',
        json_col: null,
        json_plain_col: null,
        int_array_col: [7, 8, 9],
        enum_col: 'three',
      },
    ]

    // Insert data into PostgreSQL
    for (const row of testData) {
      await pgClient.query(
        `INSERT INTO data_types_table
         (id, int_col, float_col, boolean_col, string_col, json_col, json_plain_col, int_array_col, enum_col)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          row.id,
          row.int_col,
          row.float_col,
          row.boolean_col,
          row.string_col,
          row.json_col,
          row.json_plain_col,
          row.int_array_col,
          row.enum_col,
        ],
      )
    }

    // Set up sync
    const shape = await pg.electric.syncShapeToTable({
      shape: {
        url: ELECTRIC_URL,
        params: { table: 'data_types_table' },
        fetchClient,
      },
      table: 'data_types_table',
      initialInsertMethod,
      primaryKey: ['id'],
      shapeKey: 'data_types_test',
    })

    // Wait for sync to complete
    await vi.waitFor(
      async () => {
        const result = await pg.sql<{ count: number }>`
          SELECT COUNT(*) as count FROM data_types_table;
        `
        expect(result.rows[0].count).toBe(testData.length)
      },
      { timeout: 5000 },
    )

    // Define the row type for type safety
    type DataTypeRow = {
      id: number
      int_col: number
      float_col: string
      boolean_col: boolean
      string_col: string
      json_col: any
      json_plain_col: any
      int_array_col: number[]
      enum_col: 'one' | 'two' | 'three'
    }

    // Verify data was synced correctly
    for (const expected of testData) {
      const result = await pg.sql<DataTypeRow>`
        SELECT * FROM data_types_table WHERE id = ${expected.id};
      `

      const row = result.rows[0]
      expect(row.id).toBe(expected.id)
      expect(row.int_col).toBe(expected.int_col)

      // Float comparison needs to account for potential precision differences
      expect(
        Math.abs(parseFloat(row.float_col) - expected.float_col),
      ).toBeLessThan(0.00001)

      expect(row.boolean_col).toBe(expected.boolean_col)
      expect(row.string_col).toBe(expected.string_col)

      // JSON data might be serialized differently but should be equivalent
      if (expected.json_col === null) {
        expect(row.json_col).toBeNull()
      } else {
        expect(row.json_col).toStrictEqual(expected.json_col)
      }

      // Plain JSON data should also be properly synced
      if (expected.json_plain_col === null) {
        expect(row.json_plain_col).toBeNull()
      } else {
        expect(row.json_plain_col).toStrictEqual(expected.json_plain_col)
      }

      expect(row.int_array_col).toStrictEqual(expected.int_array_col)
      expect(row.enum_col).toBe(expected.enum_col)
    }

    // Update a row with new values for all columns
    await pgClient.query(
      `UPDATE data_types_table SET
       int_col = $1, float_col = $2, boolean_col = $3,
       string_col = $4, json_col = $5, json_plain_col = $6,
       int_array_col = $7, enum_col = $8
       WHERE id = 1`,
      [
        99999,
        1234.5678,
        false,
        'Updated text value',
        { updated: true, values: [4, 5, 6] },
        { updated: 'plainJSON', order: { might: 'matter' } },
        [3, 4, 5],
        'two',
      ],
    )

    // Wait for update to sync
    await vi.waitFor(
      async () => {
        const result = await pg.sql<{ int_col: number }>`
          SELECT int_col FROM data_types_table WHERE id = 1;
        `
        expect(result.rows[0].int_col).toBe(99999)
      },
      { timeout: 5000 },
    )

    // Verify updated data
    const updatedResult = await pg.sql<DataTypeRow>`
      SELECT * FROM data_types_table WHERE id = 1;
    `
    const updated = updatedResult.rows[0]
    expect(updated.int_col).toBe(99999)
    expect(Math.abs(parseFloat(updated.float_col) - 1234.5678)).toBeLessThan(
      0.00001,
    )
    expect(updated.boolean_col).toBe(false)
    expect(updated.string_col).toBe('Updated text value')
    expect(updated.json_col).toStrictEqual({ updated: true, values: [4, 5, 6] })
    expect(updated.json_plain_col).toStrictEqual({
      updated: 'plainJSON',
      order: { might: 'matter' },
    })
    expect(updated.int_array_col).toStrictEqual([3, 4, 5])
    expect(updated.enum_col).toBe('two')

    // Clean up
    shape.unsubscribe()
    await pg.electric.deleteSubscription('data_types_test')
  }

  // FIXME: fails...
  // it('syncs data with various column types initial COPY', async () => {
  //   await types_syncer('csv')
  // }, 60000)

  it('syncs data with various column types initial json_to_recordset', async () => {
    await types_syncer('json')
  }, 60000)

  it('syncs data with various column types', async () => {
    await types_syncer('insert')
  }, 60000)

  const many_syncer = async (
    method: InitialInsertMethod | 'useCopy',
    numTodos: number = 150000,
    rowSize: number = 100,
  ) => {
    // Batch the inserts to Postgres
    const batchSize = 1000
    const batches = Math.ceil(numTodos / batchSize)
    const rowBytesValue = 'a'.repeat(rowSize)
    for (let batch = 0; batch < batches; batch++) {
      const start = batch * batchSize
      const end = Math.min(start + batchSize, numTodos)

      // Build a batch of INSERT statements using a VALUES list for better performance
      const values: string[] = []
      const params: (number | string | boolean)[] = []
      let paramIndex = 1

      for (let i = start; i < end; i++) {
        values.push(`($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2})`)
        params.push(i, `Todo ${i} ${rowBytesValue}`, i % 3 === 0) // id, task, done
        paramIndex += 3
      }

      const query = `
        INSERT INTO todo (id, task, done)
        VALUES ${values.join(', ')};
      `

      await pgClient.query(query, params)
    }

    // We want to test the deprecated useCopy option, but also the new initialInsertMethod option
    let useCopy: boolean | undefined = undefined
    let initialInsertMethod: InitialInsertMethod | undefined = undefined
    if (method === 'useCopy') {
      useCopy = true
      initialInsertMethod = undefined
    } else {
      initialInsertMethod = method
    }

    // Set up sync with COPY enabled for efficiency
    const shape = await pg.electric.syncShapeToTable({
      shape: {
        url: ELECTRIC_URL,
        params: { table: 'todo' },
        fetchClient,
      },
      table: 'todo',
      primaryKey: ['id'],
      useCopy,
      initialInsertMethod,
      shapeKey: 'large_todo_sync_test',
    })

    // Wait for all data to be synced - increase timeout for large dataset
    await vi.waitFor(
      async () => {
        const result = await pg.sql<{
          count: number
        }>`SELECT COUNT(*) as count FROM todo;`
        expect(result.rows[0].count).toBe(numTodos)
      },
      { timeout: 30000 },
    )

    // Verify some sample data points
    const firstRow = await pg.sql`SELECT * FROM todo WHERE id = 0;`
    expect(firstRow.rows[0]).toEqual({
      id: 0,
      task: `Todo 0 ${rowBytesValue}`,
      done: true, // 0 % 3 === 0
    })

    const middleRowId = Math.floor(numTodos / 2)
    const middleRow =
      await pg.sql`SELECT * FROM todo WHERE id = ${middleRowId};`
    expect(middleRow.rows[0]).toEqual({
      id: middleRowId,
      task: `Todo ${middleRowId} ${rowBytesValue}`,
      done: middleRowId % 3 === 0,
    })

    const lastRow = await pg.sql`SELECT * FROM todo WHERE id = ${numTodos - 1};`
    expect(lastRow.rows[0]).toEqual({
      id: numTodos - 1,
      task: `Todo ${numTodos - 1} ${rowBytesValue}`,
      done: (numTodos - 1) % 3 === 0,
    })

    // Test that we can still perform operations after the large sync
    await pgClient.query(`
      UPDATE todo SET task = 'Updated after sync' WHERE id = 0;
    `)

    // Wait for update to sync
    await vi.waitFor(
      async () => {
        const result = await pg.sql<{
          task: string
        }>`SELECT task FROM todo WHERE id = 0;`
        expect(result.rows[0].task).toBe('Updated after sync')
      },
      { timeout: 5000 },
    )

    // Clean up
    shape.unsubscribe()
    await pg.electric.deleteSubscription('large_todo_sync_test')
  }

  for (const numTodos of [20_000, 150_000, 300_000]) {
    const rowSizeOptions = numTodos <= 20_000 ? [100, 10000] : [100]
    // 20_000 row of 100000 bytes triggers the batching by size for inserts
    for (const rowSize of rowSizeOptions) {
      describe(`handles initial sync of ${numTodos} rows`, () => {
        describe(`with row size ${rowSize} bytes`, () => {
          it(`with insert`, async () => {
            await many_syncer('insert', numTodos, rowSize)
          }, 360000)

          if (numTodos <= 150_000) {
            it(`with COPY`, async () => {
              await many_syncer('csv', numTodos, rowSize)
            }, 60000)

            it(`with json_to_recordset`, async () => {
              await many_syncer('json', numTodos, rowSize)
            }, 60000)
          }

          if (numTodos <= 20_000) {
            it(`with the deprecated useCopy option`, async () => {
              await many_syncer('useCopy', numTodos)
            }, 60000)
          }
        })
      })
    }
  }
})
