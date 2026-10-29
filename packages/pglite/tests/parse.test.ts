import { describe, it, expect } from 'vitest'
import {
  RowDescriptionMessage,
  DataRowMessage,
  CommandCompleteMessage,
} from '@electric-sql/pg-protocol/messages'
import { parseResults, parseDescribeStatementResults } from '../src/parse'
import { ParameterDescriptionMessage } from '@electric-sql/pg-protocol/messages'

function rowDescription(
  fields: Array<{ name: string; dataTypeID: number }>,
): RowDescriptionMessage {
  const msg = new RowDescriptionMessage(0, fields.length)
  msg.fields = fields.map((field) => ({
    name: field.name,
    tableID: 0,
    columnID: 0,
    dataTypeID: field.dataTypeID,
    dataTypeSize: 0,
    dataTypeModifier: 0,
    format: 0,
  }))
  return msg
}

function dataRow(values: (string | null)[]): DataRowMessage {
  return new DataRowMessage(0, values)
}

function commandComplete(text: string): CommandCompleteMessage {
  return new CommandCompleteMessage(0, text)
}

describe('parseResults', () => {
  it('parses object-mode rows with typed values', () => {
    const messages = [
      rowDescription([
        { name: 'id', dataTypeID: 23 },
        { name: 'name', dataTypeID: 25 },
      ]),
      dataRow(['1', 'alice']),
      dataRow(['2', 'bob']),
      commandComplete('SELECT 2'),
    ]

    const [result] = parseResults(messages, {})

    expect(result.fields).toEqual([
      { name: 'id', dataTypeID: 23 },
      { name: 'name', dataTypeID: 25 },
    ])
    expect(result.rows).toEqual([
      { id: 1, name: 'alice' },
      { id: 2, name: 'bob' },
    ])
    expect(result.affectedRows).toBe(0)
  })

  it('parses array-mode rows', () => {
    const messages = [
      rowDescription([
        { name: 'id', dataTypeID: 23 },
        { name: 'active', dataTypeID: 16 },
      ]),
      dataRow(['42', 't']),
      commandComplete('SELECT 1'),
    ]

    const [result] = parseResults(messages, {}, { rowMode: 'array' })

    expect(result.rows).toEqual([[42, true]])
  })

  it('accumulates affected rows across multiple result sets', () => {
    const messages = [
      rowDescription([{ name: 'id', dataTypeID: 23 }]),
      dataRow(['1']),
      commandComplete('SELECT 1'),
      rowDescription([{ name: 'id', dataTypeID: 23 }]),
      dataRow(['2']),
      commandComplete('SELECT 1'),
    ]

    const results = parseResults(messages, {})

    expect(results).toHaveLength(2)
    expect(results[0].rows).toEqual([{ id: 1 }])
    expect(results[1].rows).toEqual([{ id: 2 }])
    expect(results[0].affectedRows).toBe(0)
    expect(results[1].affectedRows).toBe(0)
  })

  it('tracks INSERT/UPDATE/DELETE row counts', () => {
    const insert = parseResults([commandComplete('INSERT 0 3')], {})[0]
      .affectedRows
    const update = parseResults([commandComplete('UPDATE 5')], {})[0]
      .affectedRows
    const del = parseResults([commandComplete('DELETE 2')], {})[0].affectedRows

    expect(insert).toBe(3)
    expect(update).toBe(5)
    expect(del).toBe(2)
  })

  it('returns empty result set when no commandComplete is present', () => {
    const [result] = parseResults([], {})

    expect(result).toEqual({
      affectedRows: 0,
      rows: [],
      fields: [],
    })
  })

  it('applies custom parsers from options', () => {
    const messages = [
      rowDescription([{ name: 'value', dataTypeID: 25 }]),
      dataRow(['hello']),
      commandComplete('SELECT 1'),
    ]

    const [result] = parseResults(
      messages,
      {},
      {
        parsers: {
          25: (value) => `parsed:${value}`,
        },
      },
    )

    expect(result.rows).toEqual([{ value: 'parsed:hello' }])
  })

  it('attaches blob when provided', () => {
    const blob = new Blob(['test'])
    const [result] = parseResults(
      [commandComplete('SELECT 0')],
      {},
      undefined,
      blob,
    )

    expect(result.blob).toBe(blob)
  })
})

describe('parseDescribeStatementResults', () => {
  it('returns parameter type OIDs when present', () => {
    const msg = new ParameterDescriptionMessage(0, 2)
    msg.dataTypeIDs = [23, 25]

    expect(parseDescribeStatementResults([msg])).toEqual([23, 25])
  })

  it('returns empty array when parameter description is missing', () => {
    expect(parseDescribeStatementResults([])).toEqual([])
  })
})
