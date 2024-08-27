import { useEffect, useState } from 'react'
import { Results } from '@electric-sql/pglite'
import { usePGlite } from './provider'
import { query as buildQuery } from '@electric-sql/pglite/template'

function useLiveQueryImpl<T = { [key: string]: unknown }>(
  query: string,
  params: unknown[] | undefined | null,
  key?: string,
): Omit<Results<T>, 'affectedRows'> | undefined {
  const db = usePGlite()
  const [results, setResults] = useState<Results<T>>()
  useEffect(() => {
    let cancelled = false
    const cb = (results: Results<T>) => {
      if (cancelled) return
      setResults(results)
    }
    const ret =
      key !== undefined
        ? db.live.incrementalQuery<T>(query, params, key, cb)
        : db.live.query<T>(query, params, cb)

    return () => {
      cancelled = true
      ret.then(({ unsubscribe }) => unsubscribe())
    }

    // Using spread operator for params to avoid serializing it to JSON
    // or performing more complicated array equality checks
    // eslint-disable-next-line react-compiler/react-compiler
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, key, query, ...(params ?? [])])
  return (
    results && {
      rows: results.rows,
      fields: results.fields,
    }
  )
}

export function useLiveQuery<T = { [key: string]: unknown }>(
  query: string,
  params: unknown[] | undefined | null,
): Results<T> | undefined {
  return useLiveQueryImpl<T>(query, params)
}

export function useLiveSql<T = { [key: string]: unknown }>(
  strings: TemplateStringsArray,
  ...values: any[]
): Results<T> | undefined {
  const { query, params } = buildQuery(strings, ...values)
  console.log(query, params)
  return useLiveQueryImpl<T>(query, params)
}

export function useLiveIncrementalQuery<T = { [key: string]: unknown }>(
  query: string,
  params: unknown[] | undefined | null,
  key: string,
): Results<T> | undefined {
  return useLiveQueryImpl<T>(query, params, key)
}
