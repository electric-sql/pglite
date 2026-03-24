import type { PGliteInterface, Transaction } from './interface.js'
import { serialize as serializeProtocol } from '@electric-sql/pg-protocol'
import { parseDescribeStatementResults } from './parse.js'
import { TEXT } from './types.js'

/**
 * Formats a query with parameters
 * Expects that any tables/relations referenced in the query exist in the database
 * due to requiring them to be present to describe the parameters types.
 * `tx` is optional, and to be used when formatQuery is called during a transaction.
 * @param pg - The PGlite instance
 * @param query - The query to format
 * @param params - The parameters to format the query with
 * @param tx - The transaction to use, defaults to the PGlite instance
 * @returns The formatted query
 */
export async function formatQuery(
  pg: PGliteInterface,
  query: string,
  params?: any[] | null,
  tx?: Transaction | PGliteInterface,
) {
  if (!params || params.length === 0) {
    // no params so no formatting needed
    return query
  }

  tx = tx ?? pg

  // Get the types of the parameters
  const messages = []
  try {
    await pg.execProtocol(serializeProtocol.parse({ text: query }), {
      syncToFs: false,
    })

    messages.push(
      ...(
        await pg.execProtocol(serializeProtocol.describe({ type: 'S' }), {
          syncToFs: false,
        })
      ).messages,
    )
  } finally {
    messages.push(
      ...(await pg.execProtocol(serializeProtocol.sync(), { syncToFs: false }))
        .messages,
    )
  }

  const dataTypeIDs = parseDescribeStatementResults(messages)

  // replace $1, $2, etc with  %1L, %2L, etc
  const subbedQuery = query.replace(/\$([0-9]+)/g, (_, num) => {
    return '%' + num + 'L'
  })

  const ret = await tx.query<{
    query: string
  }>(
    `SELECT format($1, ${params.map((_, i) => `$${i + 2}`).join(', ')}) as query`,
    [subbedQuery, ...params],
    { paramTypes: [TEXT, ...dataTypeIDs] },
  )
  return ret.rows[0].query
}

/**
 * Debounce a function to ensure that only one instance of the function is running at
 * a time.
 * - If the function is called while an instance is already running, the new
 * call is scheduled to run after the current instance completes.
 * - If there is already a scheduled call, it is replaced with the new call.
 * @param fn - The function to debounce
 * @returns A debounced version of the function
 */
export function debounceMutex<A extends any[], R>(
  fn: (...args: A) => Promise<R>,
): (...args: A) => Promise<R | void> {
  let next:
    | {
        args: A
        resolve: (value: R | void) => void
        reject: (reason?: any) => void
      }
    | undefined = undefined

  let isRunning = false
  const processNext = async () => {
    if (!next) {
      isRunning = false
      return
    }
    isRunning = true
    const { args, resolve, reject } = next
    next = undefined
    try {
      const ret = await fn(...args)
      resolve(ret)
    } catch (e) {
      reject(e)
    } finally {
      processNext()
    }
  }
  return async (...args: A) => {
    if (next) {
      next.resolve(undefined)
    }
    const promise = new Promise<R | void>((resolve, reject) => {
      next = { args, resolve, reject }
    })
    if (!isRunning) {
      processNext()
    }
    return promise
  }
}

