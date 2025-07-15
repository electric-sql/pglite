import { query as queryTemplate } from './templating.js'
import { parseDescribeStatementResults, parseResults } from './parse.js'
import {
  type Serializer,
  type Parser,
  serializers,
  parsers,
  arraySerializer,
  arrayParser,
} from './types.js'
import type {
  DebugLevel,
  PGliteInterface,
  Results,
  Transaction,
  QueryOptions,
  ExecProtocolOptions,
  ExecProtocolResult,
  DescribeQueryResult,
} from './interface.js'

import { serialize as serializeProtocol } from '@electric-sql/pg-protocol'
import {
  RowDescriptionMessage,
  ParameterDescriptionMessage,
  DatabaseError,
} from '@electric-sql/pg-protocol/messages'
import { makePGliteError } from './errors.js'

export abstract class BasePGlite
  implements Pick<PGliteInterface, 'query' | 'sql' | 'exec' | 'transaction'>
{
  serializers: Record<number | string, Serializer> = { ...serializers }
  parsers: Record<number | string, Parser> = { ...parsers }
  #arrayTypesInitialized = false

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
  ): Promise<ExecProtocolResult>

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
    { syncToFs, dataTransferContainer }: ExecProtocolOptions,
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

  /**
   * Listen for notifications on a channel
   */
  abstract listen(
    channel: string,
    callback: (payload: string) => void,
    tx?: Transaction,
  ): Promise<(tx?: Transaction) => Promise<void>>

  // # Concrete implementations:

  /**
   * Initialize the array types
   * The oid if the type of an element and the typarray is the oid of the type of the
   * array.
   * We extract these from the database then create the serializers/parsers for
   * each type.
   * This should be called at the end of #init() in the implementing class.
   */
  async _initArrayTypes({ force = false } = {}) {
    if (this.#arrayTypesInitialized && !force) return
    this.#arrayTypesInitialized = true

    const types = await this.query<{ oid: number; typarray: number }>(`
      SELECT b.oid, b.typarray
      FROM pg_catalog.pg_type a
      LEFT JOIN pg_catalog.pg_type b ON b.oid = a.typelem
      WHERE a.typcategory = 'A'
      GROUP BY b.oid, b.typarray
      ORDER BY b.oid
    `)

    for (const type of types.rows) {
      this.serializers[type.typarray] = (x) =>
        arraySerializer(x, this.serializers[type.oid], type.typarray)
      this.parsers[type.typarray] = (x) =>
        arrayParser(x, this.parsers[type.oid], type.typarray)
    }
  }

  async #execProtocolNoSync(
    message: Uint8Array,
    options: ExecProtocolOptions = {},
  ): Promise<ExecProtocolResult> {
    return await this.execProtocol(message, { ...options, syncToFs: false })
  }

  /**
   * Re-syncs the array types from the database
   * This is useful if you add a new type to the database and want to use it, otherwise pglite won't recognize it.
   */
  async refreshArrayTypes() {
    await this._initArrayTypes({ force: true })
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
    params: any[] = [],
    options?: QueryOptions,
  ): Promise<Results<T>> {
    return await this._runExclusiveQuery(async () => {
      // We need to parse, bind and execute a query with parameters
      this.#log('runQuery', query, params, options)
      await this._handleBlob(options?.blob)

      let results

      try {
        const { messages: parseResults } = await this.#execProtocolNoSync(
          serializeProtocol.parse({ text: query, types: options?.paramTypes }),
          options,
        )

        const dataTypeIDs = parseDescribeStatementResults(
          (
            await this.#execProtocolNoSync(
              serializeProtocol.describe({ type: 'S' }),
              options,
            )
          ).messages,
        )

        const values = params.map((param, i) => {
          const oid = dataTypeIDs[i]
          if (param === null || param === undefined) {
            return null
          }
          const serialize = options?.serializers?.[oid] ?? this.serializers[oid]
          if (serialize) {
            return serialize(param)
          } else {
            return param.toString()
          }
        })

        results = [
          ...parseResults,
          ...(
            await this.#execProtocolNoSync(
              serializeProtocol.bind({
                values,
              }),
              options,
            )
          ).messages,
          ...(
            await this.#execProtocolNoSync(
              serializeProtocol.describe({ type: 'P' }),
              options,
            )
          ).messages,
          ...(
            await this.#execProtocolNoSync(
              serializeProtocol.execute({}),
              options,
            )
          ).messages,
        ]
      } catch (e) {
        if (e instanceof DatabaseError) {
          const pgError = makePGliteError({ e, options, params, query })
          throw pgError
        }
        throw e
      } finally {
        await this.#execProtocolNoSync(serializeProtocol.sync(), options)
      }

      await this._cleanupBlob()
      if (!this.#inTransaction) {
        await this.syncToFs()
      }
      const blob = await this._getWrittenBlob()
      return parseResults(results, this.parsers, options, blob)[0] as Results<T>
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
        results = (
          await this.#execProtocolNoSync(
            serializeProtocol.query(query),
            options,
          )
        ).messages
      } catch (e) {
        if (e instanceof DatabaseError) {
          const pgError = makePGliteError({
            e,
            options,
            params: undefined,
            query,
          })
          throw pgError
        }
        throw e
      } finally {
        await this.#execProtocolNoSync(serializeProtocol.sync(), options)
      }
      this._cleanupBlob()
      if (!this.#inTransaction) {
        await this.syncToFs()
      }
      const blob = await this._getWrittenBlob()
      return parseResults(
        results,
        this.parsers,
        options,
        blob,
      ) as Array<Results>
    })
  }

  /**
   * Describe a query
   * @param query The query to describe
   * @returns A description of the result types for the query
   */
  async describeQuery(
    query: string,
    options?: QueryOptions,
  ): Promise<DescribeQueryResult> {
    try {
      await this.#execProtocolNoSync(
        serializeProtocol.parse({ text: query, types: options?.paramTypes }),
        options,
      )

      const describeResults = await this.#execProtocolNoSync(
        serializeProtocol.describe({ type: 'S' }),
        options,
      )
      const paramDescription = describeResults.messages.find(
        (msg): msg is ParameterDescriptionMessage =>
          msg.name === 'parameterDescription',
      )
      const resultDescription = describeResults.messages.find(
        (msg): msg is RowDescriptionMessage => msg.name === 'rowDescription',
      )

      const queryParams =
        paramDescription?.dataTypeIDs.map((dataTypeID) => ({
          dataTypeID,
          serializer: this.serializers[dataTypeID],
        })) ?? []

      const resultFields =
        resultDescription?.fields.map((field) => ({
          name: field.name,
          dataTypeID: field.dataTypeID,
          parser: this.parsers[field.dataTypeID],
        })) ?? []

      return { queryParams, resultFields }
    } catch (e) {
      if (e instanceof DatabaseError) {
        const pgError = makePGliteError({
          e,
          options,
          params: undefined,
          query,
        })
        throw pgError
      }
      throw e
    } finally {
      await this.#execProtocolNoSync(serializeProtocol.sync(), options)
    }
  }

  /**
   * Execute a transaction
   * @param callback A callback function that takes a transaction object
   * @returns The result of the transaction
   */
  async transaction<T>(callback: (tx: Transaction) => Promise<T>): Promise<T> {
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
        listen: async (
          channel: string,
          callback: (payload: string) => void,
        ) => {
          checkClosed()
          return await this.listen(channel, callback, tx)
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
   * Run a function exclusively, no other transactions or queries will be allowed
   * while the function is running.
   * This is useful when working with the execProtocol methods as they are not blocked,
   * and do not block the locks used by transactions and queries.
   * @param fn The function to run
   * @returns The result of the function
   */
  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    return await this._runExclusiveQuery(fn)
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
