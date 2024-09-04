import { query as queryTemplate } from './templating.js'
import { parseResults } from './parse.js'
import { serializeType } from './types.js'
import type {
  DebugLevel,
  PGliteInterface,
  Results,
  Transaction,
  QueryOptions,
  ExecProtocolOptions,
} from './interface.js'

import { serialize } from '@electric-sql/pg-protocol'
import { BackendMessage } from '@electric-sql/pg-protocol/messages'

export abstract class BasePGlite
  implements Pick<PGliteInterface, 'query' | 'sql' | 'exec' | 'transaction'>
{
  // # Abstract properties:
  abstract debug: DebugLevel

  // # Private properties:
  #inTransaction = false

  // # Abstract methods:

  /**
   * Execute a postgres wire protocol message
   * @param message The postgres wire protocol message to execute
   * @returns The result of the query
   */
  abstract execProtocol(
    message: Uint8Array,
    { syncToFs, onNotice }: ExecProtocolOptions,
  ): Promise<Array<[BackendMessage, Uint8Array]>>

  /**
   * Execute a postgres wire protocol message directly without wrapping the response.
   * Only use if `execProtocol()` doesn't suite your needs.
   *
   * **Warning:** This bypasses PGlite's protocol wrappers that manage error/notice messages,
   * transactions, and notification listeners. Only use if you need to bypass these wrappers and
   * don't intend to use the above features.
   *
   * @param message The postgres wire protocol message to execute
   * @returns The direct message data response produced by Postgres
   */
  abstract execProtocolRaw(
    message: Uint8Array,
    { syncToFs }: ExecProtocolOptions,
  ): Promise<Uint8Array>

  /**
   * Sync the database to the filesystem
   * @returns Promise that resolves when the database is synced to the filesystem
   */
  abstract syncToFs(): Promise<void>

  /**
   * Handle a file attached to the current query
   * @param file The file to handle
   */
  abstract _handleBlob(blob?: File | Blob): Promise<void>

  /**
   * Get the written file
   */
  abstract _getWrittenBlob(): Promise<File | Blob | undefined>

  /**
   * Cleanup the current file
   */
  abstract _cleanupBlob(): Promise<void>

  abstract _checkReady(): Promise<void>
  abstract _runExclusiveQuery<T>(fn: () => Promise<T>): Promise<T>
  abstract _runExclusiveTransaction<T>(fn: () => Promise<T>): Promise<T>

  // # Concrete implementations:

  async #execProtocolNoSync(
    message: Uint8Array,
    options: ExecProtocolOptions = {},
  ): Promise<Array<[BackendMessage, Uint8Array]>> {
    return await this.execProtocol(message, { ...options, syncToFs: false })
  }

  /**
   * Execute a single SQL statement
   * This uses the "Extended Query" postgres wire protocol message.
   * @param query The query to execute
   * @param params Optional parameters for the query
   * @returns The result of the query
   */
  async query<T>(
    query: string,
    params?: any[],
    options?: QueryOptions,
  ): Promise<Results<T>> {
    await this._checkReady()
    // We wrap the public query method in the transaction mutex to ensure that
    // only one query can be executed at a time and not concurrently with a
    // transaction.
    return await this._runExclusiveTransaction(async () => {
      return await this.#runQuery<T>(query, params, options)
    })
  }

  /**
   * Execute a single SQL statement like with {@link PGlite.query}, but with a
   * templated statement where template values will be treated as parameters.
   *
   * You can use helpers from `/template` to further format the query with
   * identifiers, raw SQL, and nested statements.
   *
   * This uses the "Extended Query" postgres wire protocol message.
   *
   * @param query The query to execute with parameters as template values
   * @returns The result of the query
   *
   * @example
   * ```ts
   * const results = await db.sql`SELECT * FROM ${identifier`foo`} WHERE id = ${id}`
   * ```
   */
  async sql<T>(
    sqlStrings: TemplateStringsArray,
    ...params: any[]
  ): Promise<Results<T>> {
    const { query, params: actualParams } = queryTemplate(sqlStrings, ...params)
    return await this.query(query, actualParams)
  }

  /**
   * Execute a SQL query, this can have multiple statements.
   * This uses the "Simple Query" postgres wire protocol message.
   * @param query The query to execute
   * @returns The result of the query
   */
  async exec(query: string, options?: QueryOptions): Promise<Array<Results>> {
    await this._checkReady()
    // We wrap the public exec method in the transaction mutex to ensure that
    // only one query can be executed at a time and not concurrently with a
    // transaction.
    return await this._runExclusiveTransaction(async () => {
      return await this.#runExec(query, options)
    })
  }

  /**
   * Internal method to execute a query
   * Not protected by the transaction mutex, so it can be used inside a transaction
   * @param query The query to execute
   * @param params Optional parameters for the query
   * @returns The result of the query
   */
  async #runQuery<T>(
    query: string,
    params?: any[],
    options?: QueryOptions,
  ): Promise<Results<T>> {
    return await this._runExclusiveQuery(async () => {
      // We need to parse, bind and execute a query with parameters
      this.#log('runQuery', query, params, options)
      await this._handleBlob(options?.blob)
      const parsedParams =
        params?.map((p) => serializeType(p, options?.setAllTypes)) || []
      let results
      try {
        results = [
          ...(await this.#execProtocolNoSync(
            serialize.parse({
              text: query,
              types: parsedParams.map(([, type]) => type),
            }),
            options,
          )),
          ...(await this.#execProtocolNoSync(
            serialize.bind({
              values: parsedParams.map(([val]) => val),
            }),
            options,
          )),
          ...(await this.#execProtocolNoSync(
            serialize.describe({ type: 'P' }),
            options,
          )),
          ...(await this.#execProtocolNoSync(serialize.execute({}), options)),
        ]
      } finally {
        await this.#execProtocolNoSync(serialize.sync(), options)
      }
      this._cleanupBlob()
      if (!this.#inTransaction) {
        await this.syncToFs()
      }
      const blob = await this._getWrittenBlob()
      return parseResults(
        results.map(([msg]) => msg),
        options,
        blob,
      )[0] as Results<T>
    })
  }

  /**
   * Internal method to execute a query
   * Not protected by the transaction mutex, so it can be used inside a transaction
   * @param query The query to execute
   * @param params Optional parameters for the query
   * @returns The result of the query
   */
  async #runExec(
    query: string,
    options?: QueryOptions,
  ): Promise<Array<Results>> {
    return await this._runExclusiveQuery(async () => {
      // No params so we can just send the query
      this.#log('runExec', query, options)
      await this._handleBlob(options?.blob)
      let results
      try {
        results = await this.#execProtocolNoSync(
          serialize.query(query),
          options,
        )
      } finally {
        await this.#execProtocolNoSync(serialize.sync(), options)
      }
      this._cleanupBlob()
      if (!this.#inTransaction) {
        await this.syncToFs()
      }
      const blob = await this._getWrittenBlob()
      return parseResults(
        results.map(([msg]) => msg),
        options,
        blob,
      ) as Array<Results>
    })
  }

  /**
   * Execute a transaction
   * @param callback A callback function that takes a transaction object
   * @returns The result of the transaction
   */
  async transaction<T>(
    callback: (tx: Transaction) => Promise<T>,
  ): Promise<T | undefined> {
    await this._checkReady()
    return await this._runExclusiveTransaction(async () => {
      await this.#runExec('BEGIN')
      this.#inTransaction = true

      // Once a transaction is closed, we throw an error if it's used again
      let closed = false
      const checkClosed = () => {
        if (closed) {
          throw new Error('Transaction is closed')
        }
      }

      const tx: Transaction = {
        query: async <T>(
          query: string,
          params?: any[],
          options?: QueryOptions,
        ): Promise<Results<T>> => {
          checkClosed()
          return await this.#runQuery(query, params, options)
        },
        sql: async <T>(
          sqlStrings: TemplateStringsArray,
          ...params: any[]
        ): Promise<Results<T>> => {
          const { query, params: actualParams } = queryTemplate(
            sqlStrings,
            ...params,
          )
          return await this.#runQuery(query, actualParams)
        },
        exec: async (
          query: string,
          options?: QueryOptions,
        ): Promise<Array<Results>> => {
          checkClosed()
          return await this.#runExec(query, options)
        },
        rollback: async () => {
          checkClosed()
          // Rollback and set the closed flag to prevent further use of this
          // transaction
          await this.#runExec('ROLLBACK')
          closed = true
        },
        get closed() {
          return closed
        },
      }

      try {
        const result = await callback(tx)
        if (!closed) {
          closed = true
          await this.#runExec('COMMIT')
        }
        this.#inTransaction = false
        return result
      } catch (e) {
        if (!closed) {
          await this.#runExec('ROLLBACK')
        }
        this.#inTransaction = false
        throw e
      }
    })
  }

  /**
   * Internal log function
   */
  #log(...args: any[]) {
    if (this.debug > 0) {
      console.log(...args)
    }
  }
}
