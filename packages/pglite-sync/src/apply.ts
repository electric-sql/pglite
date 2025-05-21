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

export interface BulkApplyMessagesToTableOptions {
  pg: PGliteInterface | Transaction
  table: string
  schema?: string
  messages: InsertChangeMessage[]
  mapColumns?: MapColumns
  debug: boolean
}

export async function applyInsertsToTable({
  pg,
  table,
  schema = 'public',
  messages,
  mapColumns,
  debug,
}: BulkApplyMessagesToTableOptions) {
  // Map the messages to the data to be inserted
  const data: Record<string, object>[] = messages.map((message) =>
    mapColumns ? doMapColumns(mapColumns, message) : message.value,
  )

  if (debug) console.log('inserting', data)

  // Get column names from the first message
  const columns = Object.keys(data[0])

  // Calculate size of a single value
  const getValueSize = (value: any): number => {
    if (value === null) return 0

    // Handle binary data types
    if (value instanceof ArrayBuffer) return value.byteLength
    if (value instanceof Blob) return value.size
    if (value instanceof Uint8Array) return value.byteLength
    if (value instanceof DataView) return value.byteLength
    if (ArrayBuffer.isView(value)) return value.byteLength

    // Handle regular types
    switch (typeof value) {
      case 'string':
        return value.length
      case 'number':
        return 8 // assuming 8 bytes for numbers
      case 'boolean':
        return 1
      default:
        if (value instanceof Date) return 8
        return value?.toString()?.length || 0
    }
  }

  // Calculate size of a single row's values in bytes
  const getRowSize = (row: Record<string, any>): number => {
    return columns.reduce((size, column) => {
      const value = row[column]
      if (value === null) return size

      // Handle arrays
      if (Array.isArray(value)) {
        if (value.length === 0) return size

        // Check first element to determine array type
        const firstElement = value[0]

        // Handle homogeneous arrays
        switch (typeof firstElement) {
          case 'number':
            return size + value.length * 8 // 8 bytes per number
          case 'string':
            return (
              size + value.reduce((arrSize, str) => arrSize + str.length, 0)
            )
          case 'boolean':
            return size + value.length // 1 byte per boolean
          default:
            if (firstElement instanceof Date) {
              return size + value.length * 8 // 8 bytes per date
            }
            // Handle mixed or other types of arrays (including binary data)
            return (
              size +
              value.reduce((arrSize, item) => arrSize + getValueSize(item), 0)
            )
        }
      }

      return size + getValueSize(value)
    }, 0)
  }

  const MAX_PARAMS = 32_000
  const MAX_BYTES = 50 * 1024 * 1024 // 50MB

  // Helper function to execute a batch insert
  const executeBatch = async (batch: Record<string, any>[]) => {
    const sql = `
      INSERT INTO "${schema}"."${table}"
      (${columns.map((s) => `"${s}"`).join(', ')})
      VALUES
      ${batch.map((_, j) => `(${columns.map((_v, k) => '$' + (j * columns.length + k + 1)).join(', ')})`).join(', ')}
    `
    const values = batch.flatMap((message) =>
      columns.map((column) => message[column]),
    )
    await pg.query(sql, values)
  }

  let currentBatch: Record<string, any>[] = []
  let currentBatchSize = 0
  let currentBatchParams = 0

  for (let i = 0; i < data.length; i++) {
    const row = data[i]
    const rowSize = getRowSize(row)
    const rowParams = columns.length

    // Check if adding this row would exceed either limit
    if (
      currentBatch.length > 0 &&
      (currentBatchSize + rowSize > MAX_BYTES ||
        currentBatchParams + rowParams > MAX_PARAMS)
    ) {
      if (debug && currentBatchSize + rowSize > MAX_BYTES) {
        console.log('batch size limit exceeded, executing batch')
      }
      if (debug && currentBatchParams + rowParams > MAX_PARAMS) {
        console.log('batch params limit exceeded, executing batch')
      }
      await executeBatch(currentBatch)

      // Reset batch
      currentBatch = []
      currentBatchSize = 0
      currentBatchParams = 0
    }

    // Add row to current batch
    currentBatch.push(row)
    currentBatchSize += rowSize
    currentBatchParams += rowParams
  }

  // Execute final batch if there are any remaining rows
  if (currentBatch.length > 0) {
    await executeBatch(currentBatch)
  }

  if (debug) console.log(`Inserted ${messages.length} rows using INSERT`)
}

export async function applyMessagesToTableWithJson({
  pg,
  table,
  schema = 'public',
  messages,
  mapColumns,
  debug,
}: BulkApplyMessagesToTableOptions) {
  if (debug) console.log('applying messages with json_to_recordset')

  // Map the messages to the data to be inserted
  const data: Record<string, object>[] = messages.map((message) =>
    mapColumns ? doMapColumns(mapColumns, message) : message.value,
  )
  const columns = (
    await pg.query<{
      column_name: string
      udt_name: string
      data_type: string
    }>(
      `
        SELECT column_name, udt_name, data_type
        FROM information_schema.columns
        WHERE table_name = $1 AND table_schema = $2
      `,
      [table, schema],
    )
  ).rows.filter((x) =>
    Object.prototype.hasOwnProperty.call(data[0], x.column_name),
  )

  const MAX = 10_000
  for (let i = 0; i < data.length; i += MAX) {
    const maxdata = data.slice(i, i + MAX)
    await pg.query(
      `
        INSERT INTO "${schema}"."${table}"
        SELECT x.* from json_to_recordset($1) as x(${columns
          .map(
            (x) =>
              `${x.column_name} ${x.udt_name.replace(/^_/, '')}` +
              (x.data_type === 'ARRAY' ? `[]` : ''),
          )
          .join(', ')})
      `,
      [maxdata],
    )
  }

  if (debug)
    console.log(`Inserted ${messages.length} rows using json_to_recordset`)
}

export async function applyMessagesToTableWithCopy({
  pg,
  table,
  schema = 'public',
  messages,
  mapColumns,
  debug,
}: BulkApplyMessagesToTableOptions) {
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
  }
  const mappedColumns: Record<string, any> = {}
  for (const [key, value] of Object.entries(mapColumns)) {
    mappedColumns[key] = message.value[value]
  }
  return mappedColumns
}
