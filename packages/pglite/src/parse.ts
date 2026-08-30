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
  let affectedRows = 0
  const parsers = { ...defaultParsers, ...options?.parsers }

  messages.forEach((message) => {
    switch (message.name) {
      case 'rowDescription': {
        const msg = message as RowDescriptionMessage
        currentResultSet.fields = msg.fields.map((field) => ({
          name: field.name,
          dataTypeID: field.dataTypeID,
        }))
        break
      }
      case 'dataRow': {
        if (!currentResultSet) break
        const msg = message as DataRowMessage
        if (options?.rowMode === 'array') {
          currentResultSet.rows.push(
            msg.fields.map((field, i) =>
              parseType(field, currentResultSet!.fields[i].dataTypeID, parsers),
            ),
          )
        } else {
          // rowMode === "object"
          currentResultSet.rows.push(
            Object.fromEntries(
              msg.fields.map((field, i) => [
                currentResultSet!.fields[i].name,
                parseType(
                  field,
                  currentResultSet!.fields[i].dataTypeID,
                  parsers,
                ),
              ]),
            ),
          )
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
