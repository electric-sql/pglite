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

export interface SyncShapeToTableOptions extends ShapeStreamOptions {
  table: string
  schema?: string
  mapColumns?: MapColumns
  primaryKey: string[]
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
      // create subscription metadata table
      await pg.exec(subscriptionTableQuery)
      const shapeSubState = await getShapeSubscriptionState({
        pg,
        table: options.table,
      })
      if (debug && shapeSubState) {
        console.log('resuming from shape state', shapeSubState)
      }

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
          let lastOffsetAdded: Offset | void = undefined
          let shapeId: string | void = undefined

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
                  await cleanUpShapeSubscription({
                    pg: tx,
                    table: options.table,
                  })
                  break

                case 'up-to-date':
                  // no-op - we commit all messages at the end
                  break
              }
            }
          }

          if (lastOffsetAdded !== undefined && shapeId !== undefined) {
            await updateShapeSubscriptionState({
              pg: tx,
              table: options.table,
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
          // @ts-ignore - this is incorrectly marked as private
          return stream.lastOffset
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
  table: string
}

interface ShapeSubscriptionState {
  shapeId: string
  lastOffset: string
}

async function getShapeSubscriptionState({
  pg,
  table,
}: GetShapeSubscriptionStateOptions): Promise<ShapeSubscriptionState | null> {
  const result = await pg.query<{ shape_id: string; last_offset: string }>(
    `
    SELECT shape_id, last_offset
    FROM ${subscriptionTableName}
    WHERE table_name = $1
  `,
    [table],
  )

  if (result.rows.length === 0) return null

  const { shape_id: shapeId, last_offset: lastOffset } = result.rows[0]
  return {
    shapeId,
    lastOffset,
  }
}

interface UpdateShapeSubscriptionStateOptions {
  pg: PGliteInterface | Transaction
  table: string
  shapeId: string
  lastOffset: string
}

async function updateShapeSubscriptionState({
  pg,
  table,
  shapeId,
  lastOffset,
}: UpdateShapeSubscriptionStateOptions) {
  await pg.query(
    `
    INSERT INTO ${subscriptionTableName} (table_name, shape_id, last_offset)
    VALUES ($1, $2, $3)
    ON CONFLICT(table_name)
    DO UPDATE SET
      shape_id = EXCLUDED.shape_id,
      last_offset = EXCLUDED.last_offset;
  `,
    [table, shapeId, lastOffset],
  )
}

interface CleanUpShapeSubscriptionOptions {
  pg: PGliteInterface | Transaction
  table: string
}

async function cleanUpShapeSubscription({
  pg,
  table,
}: CleanUpShapeSubscriptionOptions) {
  // TODO: sync into shadow table and reference count
  // for now just clear the whole table
  await pg.exec(`TRUNCATE ${table};`)
  await pg.query(`DELETE FROM ${subscriptionTableName} WHERE table_name = $1`, [
    table,
  ])
}

const subscriptionTableName = `__electric_shape_subscriptions_metadata`
const subscriptionTableQuery = `
CREATE TABLE IF NOT EXISTS ${subscriptionTableName} (
  table_name TEXT PRIMARY KEY,
  shape_id TEXT NOT NULL,
  last_offset TEXT NOT NULL
)
`
