import { it, describe, vi, beforeEach, expect, Mock } from 'vitest'
import { Message, ShapeStream } from '@electric-sql/client'
import { PGlite, PGliteInterfaceExtensions } from '@electric-sql/pglite'
import { electricSync } from '../src/index.js'

vi.mock('@electric-sql/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@electric-sql/client')>()
  const ShapeStream = vi.fn(() => ({
    subscribe: vi.fn(),
  }))
  return { ...mod, ShapeStream }
})

describe('pglite-sync', () => {
  let pg: PGlite &
    PGliteInterfaceExtensions<{ electric: ReturnType<typeof electricSync> }>

  const MockShapeStream = ShapeStream as unknown as Mock

  beforeEach(async () => {
    pg = await PGlite.create({
      extensions: {
        electric: electricSync({}),
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
        feedMessage = (message) => cb([message])
      }),
      unsubscribeAll: vi.fn(),
    }))

    const shape = await pg.electric.syncShapeToTable({
      url: 'http://localhost:3000/v1/shape/todo',
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
})
