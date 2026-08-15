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

        // A command tag that carries a row count ends in it ("SELECT 2",
        // "UPDATE 3", "INSERT 0 5"); all other tags end in a word
        // ("CREATE TABLE").
        const parts = msg.text.split(' ')
        const command = parts[0]
        const rowCount = parseInt(parts[parts.length - 1], 10)

        switch (command) {
          case 'INSERT':
          case 'UPDATE':
          case 'DELETE':
          case 'COPY':
          case 'MERGE':
            affectedRows += rowCount
            break
        }

        const result = {
          ...currentResultSet,
          command,
          affectedRows,
        }

        if (!Number.isNaN(rowCount)) {
          result.rowCount = rowCount
        }

        if (blob) {
          result.blob = blob
        }

        resultSets.push(result)

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
