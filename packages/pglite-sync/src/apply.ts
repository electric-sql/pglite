import { ChangeMessage } from '@electric-sql/client'
import type { PGliteInterface, Transaction } from '@electric-sql/pglite'
import type { MapColumns, InsertChangeMessage } from './types'

export interface ApplyMessageToTableOptions {
  pg: PGliteInterface | Transaction
  table: string
  schema?: string
  message: ChangeMessage<any>
  mapColumns?: MapColumns
  primaryKey: string[]
  debug: boolean
}

export async function applyMessageToTable({
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
      if (columns.length === 0) return // nothing to update
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

export interface ApplyMessagesToTableWithCopyOptions {
  pg: PGliteInterface | Transaction
  table: string
  schema?: string
  messages: InsertChangeMessage[]
  mapColumns?: MapColumns
  primaryKey: string[]
  debug: boolean
}

export async function applyMessagesToTableWithCopy({
  pg,
  table,
  schema = 'public',
  messages,
  mapColumns,
  debug,
}: ApplyMessagesToTableWithCopyOptions) {
  if (debug) console.log('applying messages with COPY')

  // Map the messages to the data to be inserted
  const data: Record<string, any>[] = messages.map((message) =>
    mapColumns ? doMapColumns(mapColumns, message) : message.value,
  )

  // Get column names from the first message
  const columns = Object.keys(data[0])

  // Create CSV data
  const csvData = data
    .map((message) => {
      return columns
        .map((column) => {
          const value = message[column]
          // Escape double quotes and wrap in quotes if necessary
          if (
            typeof value === 'string' &&
            (value.includes(',') || value.includes('"') || value.includes('\n'))
          ) {
            return `"${value.replace(/"/g, '""')}"`
          }
          return value === null ? '\\N' : value
        })
        .join(',')
    })
    .join('\n')
  const csvBlob = new Blob([csvData], { type: 'text/csv' })

  // Perform COPY FROM
  await pg.query(
    `
      COPY "${schema}"."${table}" (${columns.map((c) => `"${c}"`).join(', ')})
      FROM '/dev/blob'
      WITH (FORMAT csv, NULL '\\N')
    `,
    [],
    {
      blob: csvBlob,
    },
  )

  if (debug) console.log(`Inserted ${messages.length} rows using COPY`)
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
