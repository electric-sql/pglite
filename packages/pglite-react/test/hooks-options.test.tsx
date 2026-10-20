import { act, renderHook } from '@testing-library/react'
import { waitFor } from '@testing-library/dom'
import { describe, expect, it, vi } from 'vitest'
import type { LiveQueryResults } from '@electric-sql/pglite/live'
import { useLiveQuery } from '../src/hooks'

const { usePGliteMock } = vi.hoisted(() => ({
  usePGliteMock: vi.fn(),
}))

vi.mock('../src/provider', () => ({
  usePGlite: usePGliteMock,
}))

describe('useLiveQuery query options', () => {
  it('passes options to live.query for initial and updated results', async () => {
    type Row = [number, string]
    let callback: ((results: LiveQueryResults<Row>) => void) | undefined
    const initialResults: LiveQueryResults<Row> = {
      rows: [[1, 'initial']],
      fields: [
        { name: 'id', dataTypeID: 23 },
        { name: 'name', dataTypeID: 25 },
      ],
    }
    const query = vi.fn(async (...args: unknown[]) => {
      callback = args.find(
        (arg): arg is (results: LiveQueryResults<Row>) => void =>
          typeof arg === 'function',
      )
      callback?.(initialResults)
      return {
        initialResults,
        subscribe: vi.fn(),
        unsubscribe: vi.fn(),
        refresh: vi.fn(),
      }
    })
    usePGliteMock.mockReturnValue({ live: { query } })

    const { result } = renderHook(() =>
      useLiveQuery<Row>('SELECT id, name FROM test', [], {
        rowMode: 'array',
      }),
    )

    await waitFor(() => expect(result.current).toEqual(initialResults))
    expect(query).toHaveBeenCalledTimes(1)
    expect(query).toHaveBeenCalledWith(
      'SELECT id, name FROM test',
      [],
      { rowMode: 'array' },
      expect.any(Function),
    )

    act(() => {
      callback?.({
        ...initialResults,
        rows: [
          [1, 'initial'],
          [2, 'updated'],
        ],
      })
    })

    expect(result.current?.rows).toEqual([
      [1, 'initial'],
      [2, 'updated'],
    ])
  })
})
