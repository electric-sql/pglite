import type {
  Extension,
  PGliteInterface,
  Transaction,
} from '@electric-sql/pglite'
import {
  ShapeStream,
  ChangeMessage,
  isChangeMessage,
  isControlMessage,
} from '@electric-sql/client'
import type { Offset, ShapeStreamOptions } from '@electric-sql/client'

export type MapColumnsMap = Record<string, string>
export type MapColumnsFn = (message: ChangeMessage<any>) => Record<string, any>
export type MapColumns = MapColumnsMap | MapColumnsFn
export type ShapeKey = string

export interface SyncShapeToTableOptions extends ShapeStreamOptions {
  table: string
  schema?: string
  mapColumns?: MapColumns
  primaryKey: string[]
  shapeKey?: ShapeKey
}

export interface ElectricSyncOptions {
  debug?: boolean
}

async function createPlugin(
  pg: PGliteInterface,
  options?: ElectricSyncOptions,
) {
  const debug = options?.debug ?? false
  const streams: Array<{
    stream: ShapeStream
    aborter: AbortController
  }> = []

  const namespaceObj = {
    syncShapeToTable: async (options: SyncShapeToTableOptions) => {
      let shapeSubState: ShapeSubscriptionState | null = null

      // if shapeKey is provided, ensure persistence of shape subscription
      // state is possible and check if it is already persisted
      if (options.shapeKey) {
        await pg.exec(subscriptionTableQuery)
        shapeSubState = await getShapeSubscriptionState({
          pg,
          shapeKey: options.shapeKey,
        })
        if (debug && shapeSubState) {
          console.log('resuming from shape state', shapeSubState)
        }
      }

      let lastOffsetAdded: Offset | void = shapeSubState?.offset
      let shapeId: string | void = shapeSubState?.shapeId

      const aborter = new AbortController()
      if (options.signal) {
        // we new to have our own aborter to be able to abort the stream
        // but still accept the signal from the user
        options.signal.addEventListener('abort', () => aborter.abort(), {
          once: true,
        })
      }
      const stream = new ShapeStream({
        ...options,
        ...(shapeSubState ?? {}),
        signal: aborter.signal,
      })

      stream.subscribe(async (messages) => {
        if (debug) {
          console.log('sync messages received', messages)
        }
        await pg.transaction(async (tx) => {
          for (const message of messages) {
            shapeId ??= stream.shapeId

            if (isChangeMessage(message)) {
              await applyMessageToTable({
                pg: tx,
                message: message,
                table: options.table,
                schema: options.schema,
                mapColumns: options.mapColumns,
                primaryKey: options.primaryKey,
                debug,
              })
              lastOffsetAdded = message.offset
            }

            if (isControlMessage(message)) {
              switch (message.headers.control) {
                case 'must-refetch':
                  if (debug) console.log('clearing and refetching shape')
                  shapeId = undefined
                  lastOffsetAdded = undefined

                  // TODO: sync into shadow table and reference count
                  // for now just clear the whole table
                  await tx.exec(`TRUNCATE ${options.table};`)
                  if (options.shapeKey) {
                    await deleteShapeSubscriptionState({
                      pg: tx,
                      shapeKey: options.shapeKey,
                    })
                  }
                  break

                case 'up-to-date':
                  // no-op - we commit all messages at the end
                  break
              }
            }
          }

          if (
            options.shapeKey &&
            lastOffsetAdded !== undefined &&
            shapeId !== undefined
          ) {
            await updateShapeSubscriptionState({
              pg: tx,
              shapeKey: options.shapeKey,
              shapeId,
              lastOffset: lastOffsetAdded,
            })
          }
        })
      })
      streams.push({
        stream,
        aborter,
      })
      const unsubscribe = () => {
        stream.unsubscribeAll()
        aborter.abort()
      }
      return {
        unsubscribe,
        get isUpToDate() {
          return stream.isUpToDate
        },
        get shapeId() {
          return stream.shapeId
        },
        get lastOffset() {
          return lastOffsetAdded
        },
        subscribeOnceToUpToDate: (
          cb: () => void,
          error: (err: Error) => void,
        ) => {
          return stream.subscribeOnceToUpToDate(cb, error)
        },
        unsubscribeAllUpToDateSubscribers: () => {
          stream.unsubscribeAllUpToDateSubscribers()
        },
      }
    },
  }

  const close = async () => {
    for (const { stream, aborter } of streams) {
      stream.unsubscribeAll()
      aborter.abort()
    }
  }

  return {
    namespaceObj,
    close,
  }
}

export function electricSync(options?: ElectricSyncOptions) {
  return {
    name: 'ElectricSQL Sync',
    setup: async (pg: PGliteInterface) => {
      const { namespaceObj, close } = await createPlugin(pg, options)
      return {
        namespaceObj,
        close,
      }
    },
  } satisfies Extension
}

function doMapColumns(
  mapColumns: MapColumns,
  message: ChangeMessage<any>,
): Record<string, any> {
  if (typeof mapColumns === 'function') {
    return mapColumns(message)
  } else {
    const mappedColumns: Record<string, any> = {}
    for (const [key, value] of Object.entries(mapColumns)) {
      mappedColumns[key] = message.value[value]
    }
    return mappedColumns
  }
}

interface ApplyMessageToTableOptions {
  pg: PGliteInterface | Transaction
  table: string
  schema?: string
  message: ChangeMessage<any>
  mapColumns?: MapColumns
  primaryKey: string[]
  debug: boolean
}

async function applyMessageToTable({
  pg,
  table,
  schema = 'public',
  message,
  mapColumns,
  primaryKey,
  debug,
}: ApplyMessageToTableOptions) {
  const data = mapColumns ? doMapColumns(mapColumns, message) : message.value

  switch (message.headers.operation) {
    case 'insert': {
      if (debug) console.log('inserting', data)
      const columns = Object.keys(data)
      return await pg.query(
        `
            INSERT INTO "${schema}"."${table}"
            (${columns.map((s) => '"' + s + '"').join(', ')})
            VALUES
            (${columns.map((_v, i) => '$' + (i + 1)).join(', ')})
          `,
        columns.map((column) => data[column]),
      )
    }

    case 'update': {
      if (debug) console.log('updating', data)
      const columns = Object.keys(data).filter(
        // we don't update the primary key, they are used to identify the row
        (column) => !primaryKey.includes(column),
      )
      return await pg.query(
        `
            UPDATE "${schema}"."${table}"
            SET ${columns
              .map((column, i) => '"' + column + '" = $' + (i + 1))
              .join(', ')}
            WHERE ${primaryKey
              .map(
                (column, i) =>
                  '"' + column + '" = $' + (columns.length + i + 1),
              )
              .join(' AND ')}
          `,
        [
          ...columns.map((column) => data[column]),
          ...primaryKey.map((column) => data[column]),
        ],
      )
    }

    case 'delete': {
      if (debug) console.log('deleting', data)
      return await pg.query(
        `
            DELETE FROM "${schema}"."${table}"
            WHERE ${primaryKey
              .map((column, i) => '"' + column + '" = $' + (i + 1))
              .join(' AND ')}
          `,
        [...primaryKey.map((column) => data[column])],
      )
    }
  }
}

interface GetShapeSubscriptionStateOptions {
  pg: PGliteInterface | Transaction
  shapeKey: ShapeKey
}

type ShapeSubscriptionState = Pick<ShapeStreamOptions, 'shapeId' | 'offset'>

async function getShapeSubscriptionState({
  pg,
  shapeKey,
}: GetShapeSubscriptionStateOptions): Promise<ShapeSubscriptionState | null> {
  const result = await pg.query<{ shape_id: string; last_offset: string }>(
    `
    SELECT shape_id, last_offset
    FROM ${subscriptionTableName}
    WHERE shape_key = $1
  `,
    [shapeKey],
  )

  if (result.rows.length === 0) return null

  const { shape_id: shapeId, last_offset: offset } = result.rows[0]
  return {
    shapeId,
    offset: offset as Offset,
  }
}

interface UpdateShapeSubscriptionStateOptions {
  pg: PGliteInterface | Transaction
  shapeKey: ShapeKey
  shapeId: string
  lastOffset: string
}

async function updateShapeSubscriptionState({
  pg,
  shapeKey,
  shapeId,
  lastOffset,
}: UpdateShapeSubscriptionStateOptions) {
  await pg.query(
    `
    INSERT INTO ${subscriptionTableName} (shape_key, shape_id, last_offset)
    VALUES ($1, $2, $3)
    ON CONFLICT(shape_key)
    DO UPDATE SET
      shape_id = EXCLUDED.shape_id,
      last_offset = EXCLUDED.last_offset;
  `,
    [shapeKey, shapeId, lastOffset],
  )
}

interface DeleteShapeSubscriptionStateOptions {
  pg: PGliteInterface | Transaction
  shapeKey: ShapeKey
}

async function deleteShapeSubscriptionState({
  pg,
  shapeKey,
}: DeleteShapeSubscriptionStateOptions) {
  await pg.query(`DELETE FROM ${subscriptionTableName} WHERE shape_key = $1`, [
    shapeKey,
  ])
}

const subscriptionTableName = `__electric_shape_subscriptions_metadata`
const subscriptionTableQuery = `
CREATE TABLE IF NOT EXISTS ${subscriptionTableName} (
  shape_key TEXT PRIMARY KEY,
  shape_id TEXT NOT NULL,
  last_offset TEXT NOT NULL
)
`
