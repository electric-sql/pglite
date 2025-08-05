import type { LiveQuery, LiveQueryResults } from '@electric-sql/pglite/live'
import { query as buildQuery } from '@electric-sql/pglite/template'
import { usePGlite } from './provider'
import {
  Accessor,
  createComputed,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
} from 'solid-js'

type Params = unknown[] | undefined | null
type Pagination = { limit: number; offset: number }

function useLiveQueryImpl<T = { [key: string]: unknown }>(opts: {
  query: Accessor<string | LiveQuery<T> | Promise<LiveQuery<T>>>
  params?: Accessor<Params>
  key?: Accessor<string>
  pagination?: Accessor<Pagination>
}): Accessor<Omit<LiveQueryResults<T>, 'affectedRows'> | undefined> {
  const db = usePGlite()
  const liveQuery = createMemo(
    () => {
      const originalQuery = opts.query()
      if (
        !(typeof originalQuery === 'string') &&
        !(originalQuery instanceof Promise)
      ) {
        return originalQuery
      }

      return undefined
    },
    undefined,
    { name: 'PGLiteLiveQueryMemo' },
  )

  const [results, setResults] = createSignal<LiveQueryResults<T> | undefined>(
    liveQuery()?.initialResults,
    { name: 'PGLiteResultsSignal' },
  )

  createComputed(
    () => {
      const query = liveQuery()
      if (query) {
        setResults(query.initialResults)
      }
    },
    undefined,
    { name: 'PGLiteLiveQueryInitialSyncComputed' },
  )

  const initialPagination = opts.pagination?.()
  const [queryRan] = createResource(
    () => ({ query: opts.query(), key: opts.key?.(), params: opts.params?.() }),
    async (opts) => {
      const query = opts.query
      if (typeof query === 'string') {
        const key = opts.key
        const ret =
          key != undefined
            ? db.live.incrementalQuery<T>({
                query,
                callback: setResults,
                params: opts.params,
                key,
              })
            : db.live.query({
                query,
                callback: setResults,
                params: opts.params,
                ...initialPagination,
              })

        const res = await ret
        return res
      } else if (query instanceof Promise) {
        const res = await query
        setResults(res.initialResults)
        res.subscribe(setResults)

        return res
      } else if (liveQuery()) {
        setResults(liveQuery()!.initialResults)
        liveQuery()!.subscribe(setResults)

        return liveQuery()
      } else {
        throw new Error('Should never happen')
      }
    },
    { name: 'PGLiteLiveQueryResource' },
  )

  createComputed((oldPagination: Pagination | undefined) => {
    const pagination = opts.pagination?.()

    if (
      pagination &&
      (pagination.limit !== oldPagination?.limit ||
        pagination.offset !== oldPagination?.offset)
    ) {
      queryRan()?.refresh(pagination)
      return pagination
    }

    return undefined
  }, opts.pagination?.())

  onCleanup(() => {
    queryRan()?.unsubscribe()
  })

  const aggregatedResult = createMemo(
    () => {
      queryRan()
      const res = results()
      if (res) {
        return {
          rows: res.rows,
          fields: res.fields,
          totalCount: res.totalCount,
          offset: res.offset,
          limit: res.limit,
        }
      }

      return res
    },
    undefined,
    { name: 'PGLiteLiveQueryResultMemo' },
  )

  return aggregatedResult
}

export function useLiveQuery<T = { [key: string]: unknown }>(opts: {
  query: Accessor<string>
  params?: Accessor<unknown[] | undefined | null>
  pagination?: Accessor<Pagination>
}): Accessor<LiveQueryResults<T> | undefined>

export function useLiveQuery<T = { [key: string]: unknown }>(opts: {
  query: Accessor<LiveQuery<T>>
}): Accessor<LiveQueryResults<T>>

export function useLiveQuery<T = { [key: string]: unknown }>(opts: {
  query: Accessor<Promise<LiveQuery<T>>>
}): Accessor<LiveQueryResults<T> | undefined>

export function useLiveQuery<T = { [key: string]: unknown }>(opts: {
  query: Accessor<string | LiveQuery<T> | Promise<LiveQuery<T>>>
  params?: Accessor<unknown[] | undefined | null>
  pagination?: Accessor<Pagination>
}): Accessor<LiveQueryResults<T> | undefined> {
  return useLiveQueryImpl<T>(opts)
}

useLiveQuery.sql = function <T = { [key: string]: unknown }>(
  strings: TemplateStringsArray,
  ...values: any[]
): Accessor<LiveQueryResults<T> | undefined> {
  const { query, params } = buildQuery(strings, ...values)
  return useLiveQueryImpl<T>({
    params: () => params.map((p) => (typeof p === 'function' ? p() : p)),
    query: () => query,
  })
}

export function useLiveIncrementalQuery<T = { [key: string]: unknown }>(opts: {
  query: Accessor<string | LiveQuery<T> | Promise<LiveQuery<T>>>
  params: Accessor<unknown[] | undefined | null>
  key?: Accessor<string>
}): Accessor<LiveQueryResults<T> | undefined> {
  return useLiveQueryImpl<T>(opts)
}
