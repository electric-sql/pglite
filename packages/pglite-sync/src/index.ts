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
        shapeOptions: options,
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

                  // TODO: sync into shadow table and reference count
                  // for now just clear the whole table
                  await tx.exec(`TRUNCATE ${options.table};`)
                  await deleteShapeSubscriptionState({
                    pg: tx,
                    shapeOptions: options,
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
              shapeOptions: options,
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
  shapeOptions: SyncShapeToTableOptions
}

type ShapeSubscriptionState = Pick<ShapeStreamOptions, 'shapeId' | 'offset'>

async function getShapeSubscriptionState({
  pg,
  shapeOptions,
}: GetShapeSubscriptionStateOptions): Promise<ShapeSubscriptionState | null> {
  const result = await pg.query<{ shape_id: string; last_offset: string }>(
    `
    SELECT shape_id, last_offset
    FROM ${subscriptionTableName}
    WHERE shape_hash = $1
  `,
    [sortedShapeHash(shapeOptions)],
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
  shapeOptions: SyncShapeToTableOptions
  shapeId: string
  lastOffset: string
}

async function updateShapeSubscriptionState({
  pg,
  shapeOptions,
  shapeId,
  lastOffset,
}: UpdateShapeSubscriptionStateOptions) {
  await pg.query(
    `
    INSERT INTO ${subscriptionTableName} (shape_hash, shape_id, last_offset)
    VALUES ($1, $2, $3)
    ON CONFLICT(shape_hash)
    DO UPDATE SET
      shape_id = EXCLUDED.shape_id,
      last_offset = EXCLUDED.last_offset;
  `,
    [sortedShapeHash(shapeOptions), shapeId, lastOffset],
  )
}

interface DeleteShapeSubscriptionStateOptions {
  pg: PGliteInterface | Transaction
  shapeOptions: SyncShapeToTableOptions
}

async function deleteShapeSubscriptionState({
  pg,
  shapeOptions,
}: DeleteShapeSubscriptionStateOptions) {
  const shapeHash = sortedShapeHash(shapeOptions)
  await pg.query(`DELETE FROM ${subscriptionTableName} WHERE shape_hash = $1`, [
    shapeHash,
  ])
}

/**
 * Create hash to identify shape by url, where, schema, and table
 */
function sortedShapeHash(options: SyncShapeToTableOptions): string {
  const coreShapeOpts = {
    url: options.url,
    where: options.where,
    schema: options.schema,
    table: options.table,
  }
  return JSON.stringify(coreShapeOpts, Object.keys(coreShapeOpts).sort())
}

const subscriptionTableName = `__electric_shape_subscriptions_metadata`
const subscriptionTableQuery = `
CREATE TABLE IF NOT EXISTS ${subscriptionTableName} (
  shape_hash TEXT PRIMARY KEY,
  shape_id TEXT NOT NULL,
  last_offset TEXT NOT NULL
)
`
