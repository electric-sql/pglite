import {
  BackendMessage,
  RowDescriptionMessage,
  DataRowMessage,
  CommandCompleteMessage,
  ParameterDescriptionMessage,
} from '@electric-sql/pg-protocol/messages'
import type { Results, QueryOptions } from './interface.js'
import { parseType, type Parser } from './types.js'

/**
 * This function is used to parse the results of either a simple or extended query.
 * https://www.postgresql.org/docs/current/protocol-flow.html#PROTOCOL-FLOW-SIMPLE-QUERY
 */
export function parseResults(
  messages: Array<BackendMessage>,
  defaultParsers: Record<number | string, Parser>,
  options?: QueryOptions,
  blob?: Blob,
): Array<Results> {
  const resultSets: Results[] = []
  let currentResultSet: Results = { rows: [], fields: [] }
  let fieldNames: string[] | undefined
  let fieldTypes: number[] | undefined
  let affectedRows = 0
  const parsers = { ...defaultParsers, ...options?.parsers }

  messages.forEach((message) => {
    switch (message.name) {
      case 'rowDescription': {
        const msg = message as RowDescriptionMessage
        const n = msg.fields.length
        fieldNames = new Array(n)
        fieldTypes = new Array(n)
        currentResultSet.fields = new Array(n)
        for (let i = 0; i < n; i++) {
          const field = msg.fields[i]
          fieldNames[i] = field.name
          fieldTypes[i] = field.dataTypeID
          currentResultSet.fields[i] = {
            name: field.name,
            dataTypeID: field.dataTypeID,
          }
        }
        break
      }
      case 'dataRow': {
        if (!fieldNames || !fieldTypes) break
        const msg = message as DataRowMessage
        const n = msg.fields.length
        if (options?.rowMode === 'array') {
          const row = new Array<unknown>(n)
          for (let i = 0; i < n; i++) {
            row[i] = parseType(msg.fields[i], fieldTypes[i], parsers)
          }
          currentResultSet.rows.push(row)
        } else {
          const row: Record<string, unknown> = {}
          for (let i = 0; i < n; i++) {
            row[fieldNames[i]] = parseType(
              msg.fields[i],
              fieldTypes[i],
              parsers,
            )
          }
          currentResultSet.rows.push(row)
        }
        break
      }
      case 'commandComplete': {
        const msg = message as CommandCompleteMessage
        affectedRows += retrieveRowCount(msg)

        resultSets.push({
          ...currentResultSet,
          affectedRows,
          ...(blob ? { blob } : {}),
        })

        currentResultSet = { rows: [], fields: [] }
        fieldNames = undefined
        fieldTypes = undefined
        break
      }
    }
  })

  if (resultSets.length === 0) {
    resultSets.push({
      affectedRows: 0,
      rows: [],
      fields: [],
    })
  }

  return resultSets
}

function retrieveRowCount(msg: CommandCompleteMessage): number {
  const parts = msg.text.split(' ')
  switch (parts[0]) {
    case 'INSERT':
      return parseInt(parts[2], 10)
    case 'UPDATE':
    case 'DELETE':
    case 'COPY':
    case 'MERGE':
      return parseInt(parts[1], 10)
    default:
      return 0
  }
}

/** Get the dataTypeIDs from a list of messages, if it's available. */
export function parseDescribeStatementResults(
  messages: Array<BackendMessage>,
): number[] {
  const message = messages.find(
    (msg): msg is ParameterDescriptionMessage =>
      msg.name === 'parameterDescription',
  )

  if (message) {
    return message.dataTypeIDs
  }

  return []
}
