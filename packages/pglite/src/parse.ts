import {
  BackendMessage,
  RowDescriptionMessage,
  DataRowMessage,
  CommandCompleteMessage,
  ParameterDescriptionMessage,
} from '@electric-sql/pg-protocol/messages'
import type { Results, Row, QueryOptions } from './interface.js'
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
        affectedRows += retrieveRowCount(msg)

        resultSets.push({
          ...currentResultSet,
          affectedRows,
          ...(blob ? { blob } : {}),
        })

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

export type StreamCallbackEvent =
  | {
      tag: 'rowDescription'
      fields: Results['fields']
    }
  | {
      tag: 'dataRow'
      row: Row
    }
  | {
      tag: 'commandComplete'
      results: any
    }

export function parseResult(
  message: BackendMessage,
  defaultParsers: Record<number | string, Parser>,
  currentFields: Results['fields'],
  options?: QueryOptions,
  blob?: Blob,
): StreamCallbackEvent | undefined {

  const parsers = { ...defaultParsers, ...options?.parsers }

    switch (message.name) {
      case 'rowDescription': {
        const msg = message as RowDescriptionMessage
        currentFields = msg.fields.map((field) => ({
          name: field.name,
          dataTypeID: field.dataTypeID,
        }))
        return { tag: 'rowDescription', fields: currentFields }
      }
      case 'dataRow': {
        const msg = message as DataRowMessage
        let row: Row
        if (options?.rowMode === 'array') {
          row = msg.fields.map((field, i) =>
            parseType(field, currentFields[i].dataTypeID, parsers),
          )
        } else {
          row = Object.fromEntries(
            msg.fields.map((field, i) => [
              currentFields[i].name,
              parseType(field, currentFields[i].dataTypeID, parsers),
            ]),
          )
        }
        return { tag: 'dataRow', row }
      }
      case 'commandComplete': {
        const msg = message as CommandCompleteMessage
        const affectedRows = retrieveRowCount(msg)

        return {
          tag: 'commandComplete',
          results: {
            affectedRows,
            ...(blob ? { blob } : {}),
          }
        }
      }
    }
    return undefined
}

/**
 * Streaming variant of parseResults: invokes `cb` for each rowDescription,
 * dataRow, and commandComplete message as it arrives.
 */
export function parseResultsStream(
  messages: Array<BackendMessage>,
  defaultParsers: Record<number | string, Parser>,
  cb: (event: StreamCallbackEvent) => void,
  options?: QueryOptions,
  blob?: Blob,
): void {
  let currentFields: Results['fields'] = []
  const parsers = { ...defaultParsers, ...options?.parsers }

  messages.forEach((message) => {
    switch (message.name) {
      case 'rowDescription': {
        const msg = message as RowDescriptionMessage
        currentFields = msg.fields.map((field) => ({
          name: field.name,
          dataTypeID: field.dataTypeID,
        }))
        cb({ tag: 'rowDescription', fields: currentFields })
        break
      }
      case 'dataRow': {
        const msg = message as DataRowMessage
        let row: Row
        if (options?.rowMode === 'array') {
          row = msg.fields.map((field, i) =>
            parseType(field, currentFields[i].dataTypeID, parsers),
          )
        } else {
          row = Object.fromEntries(
            msg.fields.map((field, i) => [
              currentFields[i].name,
              parseType(field, currentFields[i].dataTypeID, parsers),
            ]),
          )
        }
        cb({ tag: 'dataRow', row })
        break
      }
      case 'commandComplete': {
        const msg = message as CommandCompleteMessage
        const affectedRows = retrieveRowCount(msg)

        cb({
          tag: 'commandComplete',
          results: {
            affectedRows,
            ...(blob ? { blob } : {}),
          },
        })

        currentFields = []
        break
      }
    }
  })
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
