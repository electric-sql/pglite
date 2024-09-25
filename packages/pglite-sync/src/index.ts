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

export interface SyncShapeToTableOptions {
  shape: ShapeStreamOptions
  table: string
  schema?: string
  mapColumns?: MapColumns
  primaryKey: string[]
  shapeKey?: ShapeKey
}

export interface ElectricSyncOptions {
  debug?: boolean
  metadataSchema?: string
}

async function createPlugin(
  pg: PGliteInterface,
  options?: ElectricSyncOptions,
) {
  const debug = options?.debug ?? false
  const metadataSchema = options?.metadataSchema ?? 'electric'
  const streams: Array<{
    stream: ShapeStream
    aborter: AbortController
  }> = []

  // TODO: keeping an in-memory lock per table such that two
  // shapes are not synced into one table - this will be
  // resolved by using reference counting in shadow tables
  const shapePerTableLock = new Map<string, void>()

  const namespaceObj = {
    syncShapeToTable: async (options: SyncShapeToTableOptions) => {
      if (shapePerTableLock.has(options.table)) {
        throw new Error('Already syncing shape for table ' + options.table)
      }
      shapePerTableLock.set(options.table)
      let shapeSubState: ShapeSubscriptionState | null = null

      // if shapeKey is provided, ensure persistence of shape subscription
      // state is possible and check if it is already persisted
      if (options.shapeKey) {
        shapeSubState = await getShapeSubscriptionState({
          pg,
          metadataSchema,
          shapeKey: options.shapeKey,
        })
        if (debug && shapeSubState) {
          console.log('resuming from shape state', shapeSubState)
        }
      }

      const aborter = new AbortController()
      if (options.shape.signal) {
        // we new to have our own aborter to be able to abort the stream
        // but still accept the signal from the user
        options.shape.signal.addEventListener('abort', () => aborter.abort(), {
          once: true,
        })
      }
      const stream = new ShapeStream({
        ...options.shape,
        ...(shapeSubState ?? {}),
        signal: aborter.signal,
      })

      // TODO: this aggregates all messages in memory until an
      // up-to-date message is received, which is not viable for
      // _very_ large shapes - either we should commit batches to
      // a temporary table and copy over the transactional result
      // or use a separate connection to hold a long transaction
      let messageAggregator: ChangeMessage<any>[] = []
      let truncateNeeded = false
      let lastOffsetAdded = shapeSubState?.offset

      stream.subscribe(async (messages) => {
        if (debug) console.log('sync messages received', messages)

        for (const message of messages) {
          // accumulate change messages for committing all at once
          if (isChangeMessage(message)) {
            messageAggregator.push(message)
            continue
          }

          // perform actual DB operations upon receiving control messages
          if (!isControlMessage(message)) continue
          switch (message.headers.control) {
            // mark table as needing truncation before next batch commit
            case 'must-refetch':
              if (debug) console.log('refetching shape')
              truncateNeeded = true
              break

            // perform all accumulated changes and store stream state
            case 'up-to-date':
              await pg.transaction(async (tx) => {
                if (debug) console.log('up-to-date, committing all messages')
                if (truncateNeeded) {
                  truncateNeeded = false
                  // TODO: sync into shadow table and reference count
                  // for now just clear the whole table - will break
                  // cases with multiple shapes on the same table
                  await tx.exec(`TRUNCATE ${options.table};`)
                  if (options.shapeKey) {
                    await deleteShapeSubscriptionState({
                      pg: tx,
                      metadataSchema,
                      shapeKey: options.shapeKey,
                    })
                  }
                }

                for (const changeMessage of messageAggregator) {
                  await applyMessageToTable({
                    pg: tx,
                    table: options.table,
                    schema: options.schema,
                    message: changeMessage,
                    mapColumns: options.mapColumns,
                    primaryKey: options.primaryKey,
                    debug,
                  })
                }

                if (
                  options.shapeKey &&
                  messageAggregator.length > 0 &&
                  stream.shapeId !== undefined
                ) {
                  lastOffsetAdded =
                    messageAggregator[messageAggregator.length - 1].offset
                  await updateShapeSubscriptionState({
                    pg: tx,
                    metadataSchema,
                    shapeKey: options.shapeKey,
                    shapeId: stream.shapeId,
                    lastOffset: lastOffsetAdded,
                  })
                }
              })
              messageAggregator = []
              break
          }
        }
      })

      streams.push({
        stream,
        aborter,
      })
      const unsubscribe = () => {
        stream.unsubscribeAll()
        aborter.abort()
        shapePerTableLock.delete(options.table)
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

  const init = async () => {
    await migrateShapeMetadataTables({
      pg,
      metadataSchema,
    })
  }

  return {
    namespaceObj,
    close,
    init,
  }
}

export function electricSync(options?: ElectricSyncOptions) {
  return {
    name: 'ElectricSQL Sync',
    setup: async (pg: PGliteInterface) => {
      const { namespaceObj, close, init } = await createPlugin(pg, options)
      return {
        namespaceObj,
        close,
        init,
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
  metadataSchema: string
  shapeKey: ShapeKey
}

type ShapeSubscriptionState = Pick<ShapeStreamOptions, 'shapeId' | 'offset'>

async function getShapeSubscriptionState({
  pg,
  metadataSchema,
  shapeKey,
}: GetShapeSubscriptionStateOptions): Promise<ShapeSubscriptionState | null> {
  const result = await pg.query<{ shape_id: string; last_offset: string }>(
    `
    SELECT shape_id, last_offset
    FROM ${subscriptionMetadataTableName(metadataSchema)}
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
  metadataSchema: string
  shapeKey: ShapeKey
  shapeId: string
  lastOffset: Offset
}

async function updateShapeSubscriptionState({
  pg,
  metadataSchema,
  shapeKey,
  shapeId,
  lastOffset,
}: UpdateShapeSubscriptionStateOptions) {
  await pg.query(
    `
    INSERT INTO ${subscriptionMetadataTableName(metadataSchema)} (shape_key, shape_id, last_offset)
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
  metadataSchema: string
  shapeKey: ShapeKey
}

async function deleteShapeSubscriptionState({
  pg,
  metadataSchema,
  shapeKey,
}: DeleteShapeSubscriptionStateOptions) {
  await pg.query(
    `DELETE FROM ${subscriptionMetadataTableName(metadataSchema)} WHERE shape_key = $1`,
    [shapeKey],
  )
}

interface MigrateShapeMetadataTablesOptions {
  pg: PGliteInterface | Transaction
  metadataSchema: string
}

async function migrateShapeMetadataTables({
  pg,
  metadataSchema,
}: MigrateShapeMetadataTablesOptions) {
  await pg.exec(
    `
    CREATE SCHEMA IF NOT EXISTS "${metadataSchema}";
    CREATE TABLE IF NOT EXISTS ${subscriptionMetadataTableName(metadataSchema)} (
      shape_key TEXT PRIMARY KEY,
      shape_id TEXT NOT NULL,
      last_offset TEXT NOT NULL
    );
    `,
  )
}

function subscriptionMetadataTableName(metadatSchema: string) {
  return `"${metadatSchema}"."${subscriptionTableName}"`
}

const subscriptionTableName = `shape_subscriptions_metadata`
