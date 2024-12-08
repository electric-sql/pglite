import {
  ControlMessage,
  Message,
  ShapeStream,
  ShapeStreamOptions,
} from '@electric-sql/client'
import { PGlite, PGliteInterfaceExtensions } from '@electric-sql/pglite'
import { Mock, beforeEach, describe, expect, it, vi } from 'vitest'
import { electricSync } from '../src/index.js'

vi.mock('@electric-sql/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@electric-sql/client')>()
  const ShapeStream = vi.fn(() => ({
    subscribe: vi.fn(),
  }))
  return { ...mod, ShapeStream }
})

const upToDateMsg: ControlMessage = {
  headers: { control: 'up-to-date' },
}

describe('pglite-sync', () => {
  let pg: PGlite &
    PGliteInterfaceExtensions<{ electric: ReturnType<typeof electricSync> }>

  const MockShapeStream = ShapeStream as unknown as Mock

  beforeEach(async () => {
    pg = await PGlite.create({
      extensions: {
        electric: electricSync(),
      },
    })
    await pg.exec(`
      CREATE TABLE IF NOT EXISTS todo (
        id SERIAL PRIMARY KEY,
        task TEXT,
        done BOOLEAN
      );
    `)
    await pg.exec(`TRUNCATE todo;`)
  })

  it('handles inserts/updates/deletes', async () => {
    let feedMessage: (message: Message) => Promise<void> = async (_) => {}
    MockShapeStream.mockImplementation(() => ({
      subscribe: vi.fn((cb: (messages: Message[]) => Promise<void>) => {
        feedMessage = (message) => cb([message, upToDateMsg])
      }),
      unsubscribeAll: vi.fn(),
    }))

    const shape = await pg.electric.syncShapeToTable({
      shape: {
        url: 'http://localhost:3000/v1/shape',
        params: { table: 'todo' },
      },
      table: 'todo',
      primaryKey: ['id'],
    })

    // insert
    await feedMessage({
      headers: { operation: 'insert' },
      offset: '-1',
      key: 'id1',
      value: {
        id: 1,
        task: 'task1',
        done: false,
      },
    })
    expect((await pg.sql`SELECT* FROM todo;`).rows).toEqual([
      {
        id: 1,
        task: 'task1',
        done: false,
      },
    ])

    // update
    await feedMessage({
      headers: { operation: 'update' },
      offset: '-1',
      key: 'id1',
      value: {
        id: 1,
        task: 'task2',
        done: true,
      },
    })
    expect((await pg.sql`SELECT* FROM todo;`).rows).toEqual([
      {
        id: 1,
        task: 'task2',
        done: true,
      },
    ])

    // delete
    await feedMessage({
      headers: { operation: 'delete' },
      offset: '-1',
      key: 'id1',
      value: {
        id: 1,
        task: 'task2',
        done: true,
      },
    })
    expect((await pg.sql`SELECT* FROM todo;`).rows).toEqual([])

    shape.unsubscribe()
  })

  it('performs operations within a transaction', async () => {
    let feedMessages: (messages: Message[]) => Promise<void> = async (_) => {}
    MockShapeStream.mockImplementation(() => ({
      subscribe: vi.fn((cb: (messages: Message[]) => Promise<void>) => {
        feedMessages = (messages) => cb([...messages, upToDateMsg])
      }),
      unsubscribeAll: vi.fn(),
    }))

    const shape = await pg.electric.syncShapeToTable({
      shape: {
        url: 'http://localhost:3000/v1/shape',
        params: { table: 'todo' },
      },
      table: 'todo',
      primaryKey: ['id'],
    })

    const numInserts = 10000
    const numBatches = 5
    for (let i = 0; i < numBatches; i++) {
      const numBatchInserts = numInserts / numBatches
      feedMessages(
        Array.from({ length: numBatchInserts }, (_, idx) => {
          const itemIdx = i * numBatchInserts + idx
          return {
            headers: { operation: 'insert' },
            offset: `1_${itemIdx}`,
            key: `id${itemIdx}`,
            value: {
              id: itemIdx,
              task: `task${itemIdx}`,
              done: false,
            },
          }
        }),
      )
    }

    // let timeToProcessMicrotask = Infinity
    // const startTime = performance.now()
    // Promise.resolve().then(() => {
    //   timeToProcessMicrotask = performance.now() - startTime
    // })

    let numItemsInserted = 0
    await vi.waitUntil(async () => {
      numItemsInserted =
        (
          await pg.sql<{
            count: number
          }>`SELECT COUNT(*) as count FROM todo;`
        ).rows[0]?.['count'] ?? 0

      return numItemsInserted > 0
    })

    // should have exact number of inserts added transactionally
    expect(numItemsInserted).toBe(numInserts)

    // should have processed microtask within few ms, not blocking main loop
    // expect(timeToProcessMicrotask).toBeLessThan(15) // TODO: flaky on CI

    await shape.unsubscribe()
  })

  it('persists shape stream state and automatically resumes', async () => {
    let feedMessages: (messages: Message[]) => Promise<void> = async (_) => {}
    const shapeStreamInits = vi.fn()
    let mockShapeId: string | void = undefined
    MockShapeStream.mockImplementation((initOpts: ShapeStreamOptions) => {
      shapeStreamInits(initOpts)
      return {
        subscribe: vi.fn((cb: (messages: Message[]) => Promise<void>) => {
          feedMessages = (messages) => {
            mockShapeId ??= Math.random() + ''
            return cb([...messages, upToDateMsg])
          }
        }),
        unsubscribeAll: vi.fn(),
        get shapeId() {
          return mockShapeId
        },
      }
    })

    let totalRowCount = 0
    const numInserts = 100
    const shapeIds: string[] = []

    const numResumes = 3
    for (let i = 0; i < numResumes; i++) {
      const shape = await pg.electric.syncShapeToTable({
        shape: {
          url: 'http://localhost:3000/v1/shape',
          params: { table: 'todo' },
        },
        table: 'todo',
        primaryKey: ['id'],
        shapeKey: 'foo',
      })

      await feedMessages(
        Array.from({ length: numInserts }, (_, idx) => ({
          headers: { operation: 'insert' },
          offset: `1_${i * numInserts + idx}`,
          key: `id${i * numInserts + idx}`,
          value: {
            id: i * numInserts + idx,
            task: `task${idx}`,
            done: false,
          },
        })),
      )

      await vi.waitUntil(async () => {
        const result = await pg.sql<{
          count: number
        }>`SELECT COUNT(*) as count FROM todo;`

        if (result.rows[0]?.count > totalRowCount) {
          totalRowCount = result.rows[0].count
          return true
        }
        return false
      })
      shapeIds.push(mockShapeId!)

      expect(shapeStreamInits).toHaveBeenCalledTimes(i + 1)
      if (i === 0) {
        expect(shapeStreamInits.mock.calls[i][0]).not.toHaveProperty('shapeId')
        expect(shapeStreamInits.mock.calls[i][0]).not.toHaveProperty('offset')
      }

      shape.unsubscribe()
    }
  })

  it('clears and restarts persisted shape stream state on refetch', async () => {
    let feedMessages: (messages: Message[]) => Promise<void> = async (_) => {}
    const shapeStreamInits = vi.fn()
    let mockShapeId: string | void = undefined
    MockShapeStream.mockImplementation((initOpts: ShapeStreamOptions) => {
      shapeStreamInits(initOpts)

      return {
        subscribe: vi.fn((cb: (messages: Message[]) => Promise<void>) => {
          feedMessages = (messages) => {
            mockShapeId ??= Math.random() + ''
            if (messages.find((m) => m.headers.control === 'must-refetch')) {
              mockShapeId = undefined
            }

            return cb([...messages, upToDateMsg])
          }
        }),
        unsubscribeAll: vi.fn(),
        get shapeId() {
          return mockShapeId
        },
      }
    })

    const numInserts = 100
    const shape = await pg.electric.syncShapeToTable({
      shape: {
        url: 'http://localhost:3000/v1/shape',
        params: { table: 'todo' },
      },
      table: 'todo',
      primaryKey: ['id'],
      shapeKey: 'foo',
    })

    await feedMessages(
      Array.from({ length: numInserts }, (_, idx) => ({
        headers: { operation: 'insert' },
        offset: `1_${idx}`,
        key: `id${idx}`,
        value: {
          id: idx,
          task: `task${idx}`,
          done: false,
        },
      })),
    )

    await vi.waitUntil(async () => {
      const result = await pg.sql<{
        count: number
      }>`SELECT COUNT(*) as count FROM todo;`
      return result.rows[0]?.count === numInserts
    })

    // feed a must-refetch message that should clear the table
    // and any aggregated messages
    await feedMessages([
      {
        headers: { operation: 'insert' },
        offset: `1_${numInserts}`,
        key: `id${numInserts}`,
        value: {
          id: numInserts,
          task: `task`,
          done: false,
        },
      },
      { headers: { control: 'must-refetch' } },
      {
        headers: { operation: 'insert' },
        offset: `2_1`,
        key: `id21`,
        value: {
          id: 21,
          task: `task`,
          done: false,
        },
      },
    ])

    const result = await pg.query(`SELECT * FROM todo;`)
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toEqual({
      id: 21,
      done: false,
      task: 'task',
    })

    shape.unsubscribe()

    // resuming should
    const resumedShape = await pg.electric.syncShapeToTable({
      shape: {
        url: 'http://localhost:3000/v1/shape',
        params: { table: 'todo' },
      },
      table: 'todo',
      primaryKey: ['id'],
      shapeKey: 'foo',
    })
    resumedShape.unsubscribe()

    expect(shapeStreamInits).toHaveBeenCalledTimes(2)

    expect(shapeStreamInits.mock.calls[1][0]).not.toHaveProperty('shapeId')
    expect(shapeStreamInits.mock.calls[1][0]).not.toHaveProperty('offset')
  })

  it('uses the specified metadata schema for subscription metadata', async () => {
    const metadataSchema = 'foobar'
    const db = await PGlite.create({
      extensions: {
        electric: electricSync({
          metadataSchema,
        }),
      },
    })
    await db.electric.initMetadataTables()

    const result = await db.query(
      `SELECT schema_name FROM information_schema.schemata WHERE schema_name = $1`,
      [metadataSchema],
    )
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toEqual({ schema_name: metadataSchema })
  })

  it('forbids multiple subscriptions to the same table', async () => {
    MockShapeStream.mockImplementation(() => ({
      subscribe: vi.fn(),
      unsubscribeAll: vi.fn(),
    }))

    const table = 'foo'
    const altTable = 'bar'

    const shape1 = await pg.electric.syncShapeToTable({
      shape: {
        url: 'http://localhost:3000/v1/shape',
        params: { table: 'todo' },
      },
      table: table,
      primaryKey: ['id'],
    })

    // should throw if syncing more shapes into same table
    await expect(
      async () =>
        await pg.electric.syncShapeToTable({
          shape: {
            url: 'http://localhost:3000/v1/shape',
            params: { table: 'todo_alt' },
          },
          table: table,
          primaryKey: ['id'],
        }),
    ).rejects.toThrowError(`Already syncing shape for table ${table}`)

    // should be able to sync shape into other table
    const altShape = await pg.electric.syncShapeToTable({
      shape: {
        url: 'http://localhost:3000/v1/shape',
        params: { table: 'bar' },
      },
      table: altTable,
      primaryKey: ['id'],
    })
    altShape.unsubscribe()

    // should be able to sync different shape if previous is unsubscribed
    // (and we assume data has been cleaned up?)
    shape1.unsubscribe()

    const shape2 = await pg.electric.syncShapeToTable({
      shape: {
        url: 'http://localhost:3000/v1/shape',
        params: { table: 'todo_alt' },
      },
      table: table,
      primaryKey: ['id'],
    })
    shape2.unsubscribe()
  })

  it('handles an update message with no columns to update', async () => {
    let feedMessage: (message: Message) => Promise<void> = async (_) => {}
    MockShapeStream.mockImplementation(() => ({
      subscribe: vi.fn((cb: (messages: Message[]) => Promise<void>) => {
        feedMessage = (message) => cb([message, upToDateMsg])
      }),
      unsubscribeAll: vi.fn(),
    }))

    const shape = await pg.electric.syncShapeToTable({
      shape: {
        url: 'http://localhost:3000/v1/shape',
        params: { table: 'todo' },
      },
      table: 'todo',
      primaryKey: ['id'],
    })

    // insert
    await feedMessage({
      headers: { operation: 'insert' },
      offset: '-1',
      key: 'id1',
      value: {
        id: 1,
        task: 'task1',
        done: false,
      },
    })
    expect((await pg.sql`SELECT* FROM todo;`).rows).toEqual([
      {
        id: 1,
        task: 'task1',
        done: false,
      },
    ])

    // update with no columns to update
    await feedMessage({
      headers: { operation: 'update' },
      offset: '-1',
      key: 'id1',
      value: {
        id: 1,
      },
    })
    expect((await pg.sql`SELECT* FROM todo;`).rows).toEqual([
      {
        id: 1,
        task: 'task1',
        done: false,
      },
    ])

    shape.unsubscribe()
  })

  it('sets the syncing flag to true when syncing begins', async () => {
    let feedMessage: (message: Message) => Promise<void> = async (_) => {}
    MockShapeStream.mockImplementation(() => ({
      subscribe: vi.fn((cb: (messages: Message[]) => Promise<void>) => {
        feedMessage = (message) => cb([message, upToDateMsg])
      }),
      unsubscribeAll: vi.fn(),
    }))

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

    // Check the flag is not set outside of a sync
    const result0 =
      await pg.sql`SELECT current_setting('electric.syncing', true)`
    expect(result0.rows[0]).toEqual({ current_setting: null }) // not set yet as syncShapeToTable hasn't been called

    const shape = await pg.electric.syncShapeToTable({
      shape: {
        url: 'http://localhost:3000/v1/shape',
        params: { table: 'test_syncing' },
      },
      table: 'test_syncing',
      primaryKey: ['id'],
    })

    await feedMessage({
      headers: { operation: 'insert' },
      offset: '-1',
      key: 'id1',
      value: {
        id: 'id1',
        value: 'test value',
      },
    })

    // Check the flag is set during a sync
    const result = await pg.sql`SELECT * FROM test_syncing WHERE id = 'id1'`
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toEqual({
      id: 'id1',
      value: 'test value',
      is_syncing: true,
    })

    // Check the flag is not set outside of a sync
    const result2 =
      await pg.sql`SELECT current_setting('electric.syncing', true)`
    expect(result2.rows[0]).toEqual({ current_setting: 'false' })

    shape.unsubscribe()
  })

  it('uses COPY FROM for initial batch of inserts', async () => {
    let feedMessages: (messages: Message[]) => Promise<void> = async (_) => {}
    MockShapeStream.mockImplementation(() => ({
      subscribe: vi.fn((cb: (messages: Message[]) => Promise<void>) => {
        feedMessages = (messages) => cb([...messages, upToDateMsg])
      }),
      unsubscribeAll: vi.fn(),
    }))

    const shape = await pg.electric.syncShapeToTable({
      shape: {
        url: 'http://localhost:3000/v1/shape',
        params: { table: 'todo' },
      },
      table: 'todo',
      primaryKey: ['id'],
      useCopy: true,
    })

    // Create a batch of insert messages followed by an update
    const numInserts = 1000
    const messages: Message[] = [
      ...Array.from(
        { length: numInserts },
        (_, idx) =>
          ({
            headers: { operation: 'insert' as const },
            offset: `1_${idx}`,
            key: `id${idx}`,
            value: {
              id: idx,
              task: `task${idx}`,
              done: idx % 2 === 0,
            },
          }) as Message,
      ),
      {
        headers: { operation: 'update' as const },
        offset: `1_${numInserts}`,
        key: `id0`,
        value: {
          id: 0,
          task: 'updated task',
          done: true,
        },
      },
    ]

    await feedMessages(messages)

    // Wait for all inserts to complete
    await vi.waitUntil(async () => {
      const result = await pg.sql<{ count: number }>`
        SELECT COUNT(*) as count FROM todo;
      `
      return result.rows[0].count === numInserts
    })

    // Verify the data was inserted correctly
    const result = await pg.sql`
      SELECT * FROM todo ORDER BY id LIMIT 5;
    `
    expect(result.rows).toEqual([
      { id: 0, task: 'updated task', done: true },
      { id: 1, task: 'task1', done: false },
      { id: 2, task: 'task2', done: true },
      { id: 3, task: 'task3', done: false },
      { id: 4, task: 'task4', done: true },
    ])

    // Verify total count
    const countResult = await pg.sql<{ count: number }>`
      SELECT COUNT(*) as count FROM todo;
    `
    expect(countResult.rows[0].count).toBe(numInserts)

    shape.unsubscribe()
  })

  it('handles special characters in COPY FROM data', async () => {
    let feedMessages: (messages: Message[]) => Promise<void> = async (_) => {}
    MockShapeStream.mockImplementation(() => ({
      subscribe: vi.fn((cb: (messages: Message[]) => Promise<void>) => {
        feedMessages = (messages) => cb([...messages, upToDateMsg])
      }),
      unsubscribeAll: vi.fn(),
    }))

    const shape = await pg.electric.syncShapeToTable({
      shape: {
        url: 'http://localhost:3000/v1/shape',
        params: { table: 'todo' },
      },
      table: 'todo',
      primaryKey: ['id'],
      useCopy: true,
    })

    const specialCharMessages: Message[] = [
      {
        headers: { operation: 'insert' },
        offset: '1_0',
        key: 'id1',
        value: {
          id: 1,
          task: 'task with, comma',
          done: false,
        },
      },
      {
        headers: { operation: 'insert' },
        offset: '2_0',
        key: 'id2',
        value: {
          id: 2,
          task: 'task with "quotes"',
          done: true,
        },
      },
      {
        headers: { operation: 'insert' },
        offset: '3_0',
        key: 'id3',
        value: {
          id: 3,
          task: 'task with\nnewline',
          done: false,
        },
      },
    ]

    await feedMessages(specialCharMessages)

    // Wait for inserts to complete
    await vi.waitUntil(async () => {
      const result = await pg.sql<{ count: number }>`
        SELECT COUNT(*) as count FROM todo;
      `
      return result.rows[0].count === specialCharMessages.length
    })

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

  it('respects numeric batch commit granularity settings', async () => {
    let feedMessages: (messages: Message[]) => Promise<void> = async (_) => {}
    MockShapeStream.mockImplementation(() => ({
      subscribe: vi.fn((cb: (messages: Message[]) => Promise<void>) => {
        feedMessages = (messages) => cb([...messages, upToDateMsg])
      }),
      unsubscribeAll: vi.fn(),
    }))

    // Create a trigger to notify on transaction commit
    await pg.exec(`
      CREATE OR REPLACE FUNCTION notify_transaction()
      RETURNS TRIGGER AS $$
      BEGIN
        PERFORM pg_notify('transaction_commit', TG_TABLE_NAME);
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      CREATE TRIGGER todo_transaction_trigger
      AFTER INSERT ON todo
      FOR EACH STATEMENT
      EXECUTE FUNCTION notify_transaction();
    `)

    const commits: string[] = []
    const unsubscribe = await pg.listen('transaction_commit', (payload) => {
      commits.push(payload)
    })

    const batchSize = 5
    const shape = await pg.electric.syncShapeToTable({
      shape: {
        url: 'http://localhost:3000/v1/shape',
        params: { table: 'todo' },
      },
      table: 'todo',
      primaryKey: ['id'],
      commitGranularity: batchSize,
    })

    // Create test messages - 7 total (should see batch of 5, then 2)
    const messages = Array.from(
      { length: 7 },
      (_, idx) =>
        ({
          headers: { operation: 'insert' },
          offset: `1_${idx}`,
          key: `id${idx}`,
          value: {
            id: idx,
            task: `task${idx}`,
            done: false,
          },
        }) satisfies Message,
    )

    await feedMessages(messages)

    // Wait for all inserts to complete
    await vi.waitUntil(async () => {
      const result = await pg.sql<{ count: number }>`
        SELECT COUNT(*) as count FROM todo;
      `
      return result.rows[0].count === 7
    })

    // Verify all rows were inserted
    const result = await pg.sql`
      SELECT * FROM todo ORDER BY id;
    `
    expect(result.rows).toEqual(
      messages.map((m) => ({
        id: m.value.id,
        task: m.value.task,
        done: m.value.done,
      })),
    )

    // Should have received 2 commit notifications:
    // - One for the first batch of 5
    // - One for the remaining 2 (triggered by up-to-date message)
    expect(commits).toHaveLength(2)
    expect(commits).toEqual(['todo', 'todo'])

    await unsubscribe()
    shape.unsubscribe()
  })

  // Removed until Electric has stabilised on LSN metadata
  // it('respects transaction commit granularity', async () => {
  //   let feedMessages: (messages: Message[]) => Promise<void> = async (_) => {}
  //   MockShapeStream.mockImplementation(() => ({
  //     subscribe: vi.fn((cb: (messages: Message[]) => Promise<void>) => {
  //       feedMessages = (messages) => cb([...messages, upToDateMsg])
  //     }),
  //     unsubscribeAll: vi.fn(),
  //   }))

  //   // Create a trigger to notify on transaction commit
  //   await pg.exec(`
  //     CREATE OR REPLACE FUNCTION notify_transaction()
  //     RETURNS TRIGGER AS $$
  //     BEGIN
  //       PERFORM pg_notify('transaction_commit', TG_TABLE_NAME);
  //       RETURN NEW;
  //     END;
  //     $$ LANGUAGE plpgsql;

  //     CREATE TRIGGER todo_transaction_trigger
  //     AFTER INSERT ON todo
  //     FOR EACH STATEMENT
  //     EXECUTE FUNCTION notify_transaction();
  //   `)

  //   // Track transaction commits
  //   const transactionCommits: string[] = []
  //   const unsubscribe = await pg.listen('transaction_commit', (payload) => {
  //     transactionCommits.push(payload)
  //   })

  //   const shape = await pg.electric.syncShapeToTable({
  //     shape: {
  //       url: 'http://localhost:3000/v1/shape',
  //       params: { table: 'todo' },
  //     },
  //     table: 'todo',
  //     primaryKey: ['id'],
  //     commitGranularity: 'transaction',
  //   })

  //   // Send messages with different LSNs (first part of offset before _)
  //   await feedMessages([
  //     {
  //       headers: { operation: 'insert' },
  //       offset: '1_1', // Transaction 1
  //       key: 'id1',
  //       value: {
  //         id: 1,
  //         task: 'task1',
  //         done: false,
  //       },
  //     },
  //     {
  //       headers: { operation: 'insert' },
  //       offset: '1_2', // Same transaction
  //       key: 'id2',
  //       value: {
  //         id: 2,
  //         task: 'task2',
  //         done: false,
  //       },
  //     },
  //     {
  //       headers: { operation: 'insert' },
  //       offset: '2_1', // New transaction
  //       key: 'id3',
  //       value: {
  //         id: 3,
  //         task: 'task3',
  //         done: false,
  //       },
  //     },
  //   ])

  //   // Wait for all inserts to complete
  //   await vi.waitUntil(async () => {
  //     const result = await pg.sql<{ count: number }>`
  //       SELECT COUNT(*) as count FROM todo;
  //     `
  //     return result.rows[0].count === 3
  //   })

  //   // Verify all rows were inserted
  //   const result = await pg.sql`
  //     SELECT * FROM todo ORDER BY id;
  //   `
  //   expect(result.rows).toEqual([
  //     { id: 1, task: 'task1', done: false },
  //     { id: 2, task: 'task2', done: false },
  //     { id: 3, task: 'task3', done: false },
  //   ])

  //   // Should have received 2 transaction notifications
  //   // One for LSN 1 (containing 2 inserts) and one for LSN 2 (containing 1 insert)
  //   expect(transactionCommits).toHaveLength(2)
  //   expect(transactionCommits).toEqual(['todo', 'todo'])

  //   await unsubscribe()
  //   shape.unsubscribe()
  // })

  it('respects up-to-date commit granularity settings', async () => {
    let feedMessages: (messages: Message[]) => Promise<void> = async (_) => {}
    MockShapeStream.mockImplementation(() => ({
      subscribe: vi.fn((cb: (messages: Message[]) => Promise<void>) => {
        feedMessages = (messages) => cb([...messages, upToDateMsg])
      }),
      unsubscribeAll: vi.fn(),
    }))

    // Create a trigger to notify on transaction commit
    await pg.exec(`
      CREATE OR REPLACE FUNCTION notify_transaction()
      RETURNS TRIGGER AS $$
      BEGIN
        PERFORM pg_notify('transaction_commit', TG_TABLE_NAME);
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      CREATE TRIGGER todo_transaction_trigger
      AFTER INSERT ON todo
      FOR EACH STATEMENT
      EXECUTE FUNCTION notify_transaction();
    `)

    const commits: string[] = []
    const unsubscribe = await pg.listen('transaction_commit', (payload) => {
      commits.push(payload)
    })

    const shape = await pg.electric.syncShapeToTable({
      shape: {
        url: 'http://localhost:3000/v1/shape',
        params: { table: 'todo' },
      },
      table: 'todo',
      primaryKey: ['id'],
      commitGranularity: 'up-to-date',
    })

    // Send multiple messages
    await feedMessages([
      {
        headers: { operation: 'insert' },
        offset: '1_1',
        key: 'id1',
        value: { id: 1, task: 'task1', done: false },
      },
      {
        headers: { operation: 'insert' },
        offset: '2_1',
        key: 'id2',
        value: { id: 2, task: 'task2', done: false },
      },
      {
        headers: { operation: 'insert' },
        offset: '3_1',
        key: 'id3',
        value: { id: 3, task: 'task3', done: false },
      },
    ])

    // Wait for all inserts to complete
    await vi.waitUntil(async () => {
      const result = await pg.sql<{ count: number }>`
        SELECT COUNT(*) as count FROM todo;
      `
      return result.rows[0].count === 3
    })

    // Should have received only one commit notification since all operations
    // are committed together when up-to-date message is received
    expect(commits).toHaveLength(1)
    expect(commits).toEqual(['todo'])

    await unsubscribe()
    shape.unsubscribe()
  })

  it('respects operation commit granularity settings', async () => {
    let feedMessages: (messages: Message[]) => Promise<void> = async (_) => {}
    MockShapeStream.mockImplementation(() => ({
      subscribe: vi.fn((cb: (messages: Message[]) => Promise<void>) => {
        feedMessages = (messages) => cb([...messages, upToDateMsg])
      }),
      unsubscribeAll: vi.fn(),
    }))

    // Create a trigger to notify on transaction commit
    await pg.exec(`
      CREATE OR REPLACE FUNCTION notify_transaction()
      RETURNS TRIGGER AS $$
      BEGIN
        PERFORM pg_notify('transaction_commit', TG_TABLE_NAME);
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      CREATE TRIGGER todo_transaction_trigger
      AFTER INSERT ON todo
      FOR EACH STATEMENT
      EXECUTE FUNCTION notify_transaction();
    `)

    const commits: string[] = []
    const unsubscribe = await pg.listen('transaction_commit', (payload) => {
      commits.push(payload)
    })

    const shape = await pg.electric.syncShapeToTable({
      shape: {
        url: 'http://localhost:3000/v1/shape',
        params: { table: 'todo' },
      },
      table: 'todo',
      primaryKey: ['id'],
      commitGranularity: 'operation',
    })

    // Send multiple messages
    await feedMessages([
      {
        headers: { operation: 'insert' },
        offset: '1_1',
        key: 'id1',
        value: { id: 1, task: 'task1', done: false },
      },
      {
        headers: { operation: 'insert' },
        offset: '1_2',
        key: 'id2',
        value: { id: 2, task: 'task2', done: false },
      },
      {
        headers: { operation: 'insert' },
        offset: '1_3',
        key: 'id3',
        value: { id: 3, task: 'task3', done: false },
      },
    ])

    // Wait for all inserts to complete
    await vi.waitUntil(async () => {
      const result = await pg.sql<{ count: number }>`
        SELECT COUNT(*) as count FROM todo;
      `
      return result.rows[0].count === 3
    })

    // Should have received a notification for each operation
    expect(commits).toHaveLength(3)
    expect(commits).toEqual(['todo', 'todo', 'todo'])

    await unsubscribe()
    shape.unsubscribe()
  })

  // Skip this test as it's flaky in CI, timing is sensitive
  it.skip('respects commitThrottle with operation commit granularity', async () => {
    let feedMessages: (messages: Message[]) => Promise<void> = async (_) => {}
    MockShapeStream.mockImplementation(() => ({
      subscribe: vi.fn((cb: (messages: Message[]) => Promise<void>) => {
        feedMessages = (messages) => cb([...messages])
      }),
      unsubscribeAll: vi.fn(),
    }))

    // Create a trigger to notify on transaction commit
    await pg.exec(`
      CREATE OR REPLACE FUNCTION notify_transaction()
      RETURNS TRIGGER AS $$
      BEGIN
        PERFORM pg_notify('transaction_commit', 
          TG_TABLE_NAME || '_' || 
          (SELECT COUNT(*) FROM todo)::text || '_' ||
          EXTRACT(MILLISECONDS FROM NOW())::text
        );
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      CREATE TRIGGER todo_transaction_trigger
      AFTER INSERT ON todo
      FOR EACH STATEMENT
      EXECUTE FUNCTION notify_transaction();
    `)

    const commits: string[] = []
    const unsubscribe = await pg.listen('transaction_commit', (payload) => {
      commits.push(payload)
    })

    const throttleMs = 15 // Short throttle for testing
    const shape = await pg.electric.syncShapeToTable({
      shape: {
        url: 'http://localhost:3000/v1/shape',
        params: { table: 'todo' },
      },
      table: 'todo',
      primaryKey: ['id'],
      commitGranularity: 'operation',
      commitThrottle: throttleMs,
    })

    // Send messages with 10ms delays between them
    for (const message of [
      {
        headers: { operation: 'insert' as const },
        offset: '1_1' as const,
        key: 'id1',
        value: { id: 1, task: 'task1', done: false },
      },
      {
        headers: { operation: 'insert' as const },
        offset: '1_2' as const,
        key: 'id2',
        value: { id: 2, task: 'task2', done: false },
      },
      {
        headers: { operation: 'insert' as const },
        offset: '1_3' as const,
        key: 'id3',
        value: { id: 3, task: 'task3', done: false },
      },
      {
        headers: { operation: 'insert' as const },
        offset: '1_4' as const,
        key: 'id4',
        value: { id: 4, task: 'task4', done: false },
      },
      upToDateMsg,
    ]) {
      await feedMessages([message])
      await new Promise((resolve) => setTimeout(resolve, 10))
    }

    // Wait for all inserts to complete
    await vi.waitUntil(async () => {
      const result = await pg.sql<{ count: number }>`
        SELECT COUNT(*) as count FROM todo;
      `
      return result.rows[0].count === 4
    })

    console.log(commits)

    // Extract row counts and timestamps from commit notifications
    const commitInfo = commits.map((commit) => {
      const [_, rowCount, timestamp] = commit.split('_')
      return {
        rowCount: parseInt(rowCount),
        timestamp: parseFloat(timestamp),
      }
    })

    // Verify we got 4 operation messages
    expect(commitInfo.length).toBe(4)

    // Check timestamps are at least 15ms apart for first 3
    expect(
      commitInfo[1].timestamp - commitInfo[0].timestamp,
    ).toBeGreaterThanOrEqual(15)
    expect(
      commitInfo[2].timestamp - commitInfo[1].timestamp,
    ).toBeGreaterThanOrEqual(15)

    // Last 2 operation messages should have same timestamp since they're batched
    expect(commitInfo[3].timestamp).toBe(commitInfo[2].timestamp)

    await unsubscribe()
    shape.unsubscribe()
  })

  it('calls onInitialSync callback after initial sync', async () => {
    let feedMessages: (messages: Message[]) => Promise<void> = async (_) => {}
    MockShapeStream.mockImplementation(() => ({
      subscribe: vi.fn((cb: (messages: Message[]) => Promise<void>) => {
        feedMessages = (messages) => cb([...messages, upToDateMsg])
      }),
      unsubscribeAll: vi.fn(),
    }))

    const onInitialSync = vi.fn()
    const shape = await pg.electric.syncShapeToTable({
      shape: {
        url: 'http://localhost:3000/v1/shape',
        params: { table: 'todo' },
      },
      table: 'todo',
      primaryKey: ['id'],
      onInitialSync,
    })

    // Send some initial data
    await feedMessages([
      {
        headers: { operation: 'insert' },
        offset: '1_1',
        key: 'id1',
        value: {
          id: 1,
          task: 'task1',
          done: false,
        },
      },
      {
        headers: { operation: 'insert' },
        offset: '1_2',
        key: 'id2',
        value: {
          id: 2,
          task: 'task2',
          done: true,
        },
      },
    ])

    // Verify callback was called once
    expect(onInitialSync).toHaveBeenCalledTimes(1)

    // Send more data - callback should not be called again
    await feedMessages([
      {
        headers: { operation: 'insert' },
        offset: '1_3',
        key: 'id3',
        value: {
          id: 3,
          task: 'task3',
          done: false,
        },
      },
    ])

    // Verify callback was still only called once
    expect(onInitialSync).toHaveBeenCalledTimes(1)

    // Verify all data was inserted
    expect(
      (await pg.sql<{ count: number }>`SELECT COUNT(*) as count FROM todo;`)
        .rows[0].count,
    ).toBe(3)

    shape.unsubscribe()
  })
})
