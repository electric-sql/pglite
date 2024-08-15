import { type PGliteInterface } from '@electric-sql/pglite'
import { describe } from 'psql-describe'
import type { Results, Response } from './types'

export async function runQuery(query: string, pg: PGliteInterface): Promise<Response> {
  if (query.trim().toLowerCase().startsWith('\\')) {
    return runDescribe(query, pg)
  }
  const start = performance.now()
  try {
    const result = await pg.exec(query, {
      rowMode: 'array',
    })
    const elapsed = performance.now() - start
    return {
      query,
      results: result as Results[],
      time: elapsed,
    }
  } catch (err) {
    return {
      query,
      error: (err as Error).message,
      time: performance.now() - start,
    }
  }
}

export async function runDescribe(
  query: string,
  pg: PGliteInterface,
): Promise<Response> {
  const start = performance.now()
  let out: string | Record<string, unknown> | undefined
  let ret: Results
  const { promise, cancel: _cancel } = describe(
    query,
    'postgres',
    async (sql) => {
      ret = (await pg.exec(sql, { rowMode: 'array' }))[0] as Results
      return {
        rows: ret.rows,
        fields: ret.fields,
        rowCount: ret.rows.length,
      }
    },
    (output) => {
      out = output
    },
  )
  await promise
  const elapsed = performance.now() - start

  if (!out) {
    return {
      query,
      error: 'No output',
      time: elapsed,
    }
  } else if (typeof out === 'string') {
    if (out.startsWith('ERROR:')) {
      return {
        query,
        error: out,
        time: elapsed,
      }
    } else {
      return {
        query,
        text: out,
        time: elapsed,
      }
    }
  } else {
    return {
      query,
      text: out.title as string,
      results: [ret!],
      time: elapsed,
    }
  }
}

export async function getSchema(pg: PGliteInterface): Promise<Record<string, string[]>> {
  const ret = await pg.query<{
    schema: string
    table: string
    columns: string
  }>(`
    SELECT 
      table_schema AS schema,
      table_name AS table,
      array_agg(column_name) AS columns
    FROM 
      information_schema.columns
    GROUP BY 
      table_schema, table_name
    ORDER BY 
      table_schema, table_name;
  `)
  const schema: Record<string, string[]> = {}
  for (const row of ret.rows) {
    schema[`${row.schema}.${row.table}`] = Array.isArray(row.columns)
      ? row.columns
      : row.columns.slice(1, -1).split(',')
  }
  return schema
}
