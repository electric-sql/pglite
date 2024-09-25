import { it, describe, vi, beforeEach, expect, Mock } from 'vitest'
import {
  ControlMessage,
  Message,
  ShapeStream,
  ShapeStreamOptions,
} from '@electric-sql/client'
import { PGlite, PGliteInterfaceExtensions } from '@electric-sql/pglite'
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
      shapeStream: { url: 'http://localhost:3000/v1/shape/todo' },
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

    await shape.unsubscribe()
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
      shapeStream: { url: 'http://localhost:3000/v1/shape/todo' },
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

    let timeToProcessMicrotask = Infinity
    const startTime = performance.now()
    Promise.resolve().then(() => {
      timeToProcessMicrotask = performance.now() - startTime
    })

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
    expect(timeToProcessMicrotask).toBeLessThan(5)

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
        shapeStream: { url: 'http://localhost:3000/v1/shape/todo' },
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
      await shape.unsubscribe()

      expect(shapeStreamInits).toHaveBeenCalledTimes(i + 1)
      if (i === 0) {
        expect(shapeStreamInits.mock.calls[i][0]).not.toHaveProperty('shapeId')
        expect(shapeStreamInits.mock.calls[i][0]).not.toHaveProperty('offset')
      } else {
        expect(shapeStreamInits.mock.calls[i][0]).toMatchObject({
          shapeId: shapeIds[i],
          offset: `1_${i * numInserts - 1}`,
        })
      }
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
      shapeStream: { url: 'http://localhost:3000/v1/shape/todo' },
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
    await feedMessages([
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

    await shape.unsubscribe()

    // resuming should
    const resumedShape = await pg.electric.syncShapeToTable({
      shapeStream: { url: 'http://localhost:3000/v1/shape/todo' },
      table: 'todo',
      primaryKey: ['id'],
      shapeKey: 'foo',
    })
    await resumedShape.unsubscribe()

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
      shapeStream: { url: 'http://localhost:3000/v1/shape/todo' },
      table: table,
      primaryKey: ['id'],
    })

    // should throw if syncing more shapes into same table
    await expect(
      async () =>
        await pg.electric.syncShapeToTable({
          shapeStream: { url: 'http://localhost:3000/v1/shape/todo_alt' },
          table: table,
          primaryKey: ['id'],
        }),
    ).rejects.toThrowError(`Already syncing shape for table ${table}`)

    // should be able to sync shape into other table
    const altShape = await pg.electric.syncShapeToTable({
      shapeStream: { url: 'http://localhost:3000/v1/shape/bar' },
      table: altTable,
      primaryKey: ['id'],
    })
    await altShape.unsubscribe()

    // should be able to sync different shape if previous is unsubscribed
    // (and we assume data has been cleaned up?)
    await shape1.unsubscribe()

    const shape2 = await pg.electric.syncShapeToTable({
      shapeStream: { url: 'http://localhost:3000/v1/shape/todo_alt' },
      table: table,
      primaryKey: ['id'],
    })
    await shape2.unsubscribe()
  })
})
