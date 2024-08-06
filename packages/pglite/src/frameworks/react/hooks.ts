import { useEffect, useState } from "react";
import { Results } from "../../interface";
import { usePGlite } from "./provider";

function useLiveQueryImpl<T = { [key: string]: any }>(
  query: string,
  params: any[] | undefined | null,
  key?: string,
): Results<T> | undefined {
  const pg = usePGlite();
  const [results, setResults] = useState<Results<T>>();
  useEffect(() => {
    let cancelled = false;
    const cb = (results: Results<T>) => {
      if (cancelled) return;
      setResults(results);
    };
    const ret =
      key !== undefined
        ? pg.live.incrementalQuery<T>(query, params, key, cb)
        : pg.live.query<T>(query, params, cb);

    return () => {
      cancelled = true;
      ret.then(({ unsubscribe }) => unsubscribe());
    };
  }, [pg, query, params]);
  return results;
}

export function useLiveQuery<T = { [key: string]: any }>(
  query: string,
  params: any[] | undefined | null,
): Results<T> | undefined {
  return useLiveQueryImpl<T>(query, params);
}

export function useLiveIncrementalQuery<T = { [key: string]: any }>(
  query: string,
  params: any[] | undefined | null,
  key: string,
): Results<T> | undefined {
  return useLiveQueryImpl<T>(query, params, key);
}
