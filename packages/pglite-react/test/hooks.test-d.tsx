import { describe, it, expectTypeOf } from 'vitest'
import type { QueryOptions } from '@electric-sql/pglite'
import type { LiveQueryOptions } from '@electric-sql/pglite/live'
import { useLiveQuery } from '../src'

describe('useLiveQuery types', () => {
  it('accepts exported query options in object and positional APIs', () => {
    const queryOptions: QueryOptions = { rowMode: 'array' }
    const liveOptions: LiveQueryOptions<[number, string]> = {
      query: 'SELECT id, name FROM test',
      ...queryOptions,
    }

    expectTypeOf(liveOptions.rowMode).toEqualTypeOf<QueryOptions['rowMode']>()
    ;() =>
      useLiveQuery<[number, string]>(
        'SELECT id, name FROM test',
        [],
        queryOptions,
      )
  })
})
