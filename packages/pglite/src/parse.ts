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

  const processMessageTypes = new Set([
    'rowDescription',
    'dataRow',
    'commandComplete',
  ])

  const filteredMessages = messages.filter((msg) =>
    processMessageTypes.has(msg.name),
  )

  filteredMessages.forEach((message, index) => {
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
        affectedRows += retrieveRowCount(msg)

        if (index === filteredMessages.length - 1) {
          resultSets.push({
            ...currentResultSet,
            affectedRows,
            ...(blob ? { blob } : {}),
          })
        } else {
          resultSets.push(currentResultSet)
        }

        currentResultSet = { rows: [], fields: [] }
        break
      }
    }
  })

  if (resultSets.length === 0) {
    resultSets.push({
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
