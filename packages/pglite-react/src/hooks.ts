import { useEffect, useState, useRef } from 'react'
import { Results } from '@electric-sql/pglite'
import { usePGlite } from './provider'
import { query as buildQuery } from '@electric-sql/pglite/template'

function arrayEqual(a1: any[], a2: any[]) {
  if (a1.length !== a2.length) return false
  for (let i = 0; i < a1.length; i++) {
    if (Object.is(a1[i], a2[i])) {
      return false
    }
  }
  return true
}

function useLiveQueryImpl<T = { [key: string]: unknown }>(
  query: string,
  params: unknown[] | undefined | null,
  key?: string,
): Omit<Results<T>, 'affectedRows'> | undefined {
  const db = usePGlite()
  const [results, setResults] = useState<Results<T>>()

  // We manually check for changes to params so that we can support as change to the
  // number of params
  const paramsRef = useRef<unknown[] | undefined | null>(params)
  if (!arrayEqual(paramsRef.current as any[], params as any[])) {
    paramsRef.current = params
  }

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
  }, [db, key, query, paramsRef.current])
  return (
    results && {
      rows: results.rows,
      fields: results.fields,
    }
  )
}

export function useLiveQuery<T = { [key: string]: unknown }>(
  query: string,
  params?: unknown[] | null,
): Results<T> | undefined {
  return useLiveQueryImpl<T>(query, params)
}

useLiveQuery.sql = function <T = { [key: string]: unknown }>(
  strings: TemplateStringsArray,
  ...values: any[]
): Results<T> | undefined {
  const { query, params } = buildQuery(strings, ...values)
  // eslint-disable-next-line react-compiler/react-compiler
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useLiveQueryImpl<T>(query, params)
}

export function useLiveIncrementalQuery<T = { [key: string]: unknown }>(
  query: string,
  params: unknown[] | undefined | null,
  key: string,
): Results<T> | undefined {
  return useLiveQueryImpl<T>(query, params, key)
}
