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

function paramsEqual(
  a1: unknown[] | undefined | null,
  a2: unknown[] | undefined | null,
) {
  if (!a1 && !a2) return true
  if (a1?.length !== a2?.length) return false
  for (let i = 0; i < a1!.length; i++) {
    if (!Object.is(a1![i], a2![i])) {
      return false
    }
  }
  return true
}

type Params = unknown[] | undefined | null

function useLiveQueryImpl<T = { [key: string]: unknown }>(
  opts: Accessor<{
    query: string | LiveQuery<T> | Promise<LiveQuery<T>>
    params?: Params
    key?: string
  }>,
): Accessor<Omit<LiveQueryResults<T>, 'affectedRows'> | undefined> {
  const db = usePGlite()
  const liveQuery = createMemo(
    () => {
      const originalQuery = opts().query
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

  const params = createMemo(
    (prev) => {
      if (!paramsEqual(opts().params, prev as Params)) {
        return opts().params
      }

      return prev as Params
    },
    opts().params,
    { name: 'PGLiteLiveQueryParamsMemo' },
  )

  const [queryRan] = createResource(
    opts,
    async (opts) => {
      const query = opts.query
      if (typeof query === 'string') {
        const key = opts.key
        const ret =
          key != undefined
            ? db.live.incrementalQuery<T>(query, params(), key, setResults)
            : db.live.query<T>(query, params(), setResults)

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

export function useLiveQuery<T = { [key: string]: unknown }>(
  opts: Accessor<{
    query: string
    params: unknown[] | undefined | null
  }>,
): Accessor<LiveQueryResults<T> | undefined>

export function useLiveQuery<T = { [key: string]: unknown }>(
  opts: Accessor<{
    query: LiveQuery<T>
  }>,
): Accessor<LiveQueryResults<T>>

export function useLiveQuery<T = { [key: string]: unknown }>(
  opts: Accessor<{
    query: Promise<LiveQuery<T>>
  }>,
): Accessor<LiveQueryResults<T> | undefined>

export function useLiveQuery<T = { [key: string]: unknown }>(
  opts: Accessor<{
    query: string | LiveQuery<T> | Promise<LiveQuery<T>>
    params?: unknown[] | undefined | null
  }>,
): Accessor<LiveQueryResults<T> | undefined> {
  return useLiveQueryImpl<T>(opts)
}

useLiveQuery.sql = function <T = { [key: string]: unknown }>(
  strings: TemplateStringsArray,
  ...values: any[]
): Accessor<LiveQueryResults<T> | undefined> {
  const { query, params } = buildQuery(strings, ...values)
  return useLiveQueryImpl<T>(() => ({
    params: params.map((p) => (typeof p === 'function' ? p() : p)),
    query,
  }))
}

export function useLiveIncrementalQuery<T = { [key: string]: unknown }>(
  opts: Accessor<{
    query: string | LiveQuery<T> | Promise<LiveQuery<T>>
    params: unknown[] | undefined | null
    key?: string
  }>,
): Accessor<LiveQueryResults<T> | undefined> {
  return useLiveQueryImpl<T>(opts)
}
