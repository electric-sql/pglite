import type {
  Extension,
  PGliteInterface,
  Transaction,
} from '@electric-sql/pglite'
import { ShapeStream, Message, ChangeMessage } from '@electric-sql/client'
import type { ShapeStreamOptions } from '@electric-sql/client'

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
        signal: aborter.signal,
      })
      stream.subscribe(async (messages) => {
        if (debug) {
          console.log('sync messages received', messages)
        }
        for (const message of messages) {
          pg.transaction(async (tx) => {
            await applyMessageToTable({
              pg: tx,
              rawMessage: message,
              table: options.table,
              schema: options.schema,
              mapColumns: options.mapColumns,
              primaryKey: options.primaryKey,
              debug,
            })
          })
        }
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
  rawMessage: Message
  mapColumns?: MapColumns
  primaryKey: string[]
  debug: boolean
}

async function applyMessageToTable({
  pg,
  table,
  schema = 'public',
  rawMessage,
  mapColumns,
  primaryKey,
  debug,
}: ApplyMessageToTableOptions) {
  if (!(rawMessage as any).headers.operation) return
  const message = rawMessage as ChangeMessage<any>
  const data = mapColumns ? doMapColumns(mapColumns, message) : message.value
  if (message.headers.operation === 'insert') {
    if (debug) {
      console.log('inserting', data)
    }
    const columns = Object.keys(data)
    await pg.query(
      `
        INSERT INTO "${schema}"."${table}"
        (${columns.map((s) => '"' + s + '"').join(', ')})
        VALUES
        (${columns.map((_v, i) => '$' + (i + 1)).join(', ')})
      `,
      columns.map((column) => data[column]),
    )
  } else if (message.headers.operation === 'update') {
    if (debug) {
      console.log('updating', data)
    }
    const columns = Object.keys(data).filter(
      // we don't update the primary key, they are used to identify the row
      (column) => !primaryKey.includes(column),
    )
    await pg.query(
      `
        UPDATE "${schema}"."${table}"
        SET ${columns
          .map((column, i) => '"' + column + '" = $' + (i + 1))
          .join(', ')}
        WHERE ${primaryKey
          .map((column, i) => '"' + column + '" = $' + (columns.length + i + 1))
          .join(' AND ')}
      `,
      [
        ...columns.map((column) => data[column]),
        ...primaryKey.map((column) => data[column]),
      ],
    )
  } else if (message.headers.operation === 'delete') {
    if (debug) {
      console.log('deleting', data)
    }
    await pg.query(
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
