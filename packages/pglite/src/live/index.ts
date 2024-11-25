import type {
  Extension,
  PGliteInterface,
  Results,
  Transaction,
} from '../interface'
import type {
  LiveQueryOptions,
  LiveIncrementalQueryOptions,
  LiveChangesOptions,
  LiveNamespace,
  LiveQuery,
  LiveChanges,
  Change,
  LiveQueryResults,
} from './interface'
import { uuid, formatQuery, debounceMutex } from '../utils.js'

export type {
  LiveNamespace,
  LiveQuery,
  LiveChanges,
  Change,
  LiveQueryResults,
} from './interface.js'

const MAX_RETRIES = 5

const setup = async (pg: PGliteInterface, _emscriptenOpts: any) => {
  // The notify triggers are only ever added and never removed
  // Keep track of which triggers have been added to avoid adding them multiple times
  const tableNotifyTriggersAdded = new Set<string>()

  const namespaceObj: LiveNamespace = {
    async query<T>(
      query: string | LiveQueryOptions<T>,
      params?: any[] | null,
      callback?: (results: Results<T>) => void,
    ) {
      let signal: AbortSignal | undefined
      let offset: number | undefined
      let limit: number | undefined
      if (typeof query !== 'string') {
        signal = query.signal
        params = query.params
        callback = query.callback
        offset = query.offset
        limit = query.limit
        query = query.query
      }

      // Offset and limit must be provided together
      if ((offset === undefined) !== (limit === undefined)) {
        throw new Error('offset and limit must be provided together')
      }

      const isWindowed = offset !== undefined && limit !== undefined
      let totalCount: number | undefined = undefined

      if (
        isWindowed &&
        (typeof offset !== 'number' ||
          isNaN(offset) ||
          typeof limit !== 'number' ||
          isNaN(limit))
      ) {
        throw new Error('offset and limit must be numbers')
      }

      let callbacks: Array<(results: Results<T>) => void> = callback
        ? [callback]
        : []
      const id = uuid().replace(/-/g, '')
      let dead = false

      let results: LiveQueryResults<T>
      let tables: { table_name: string; schema_name: string }[]

      const init = async () => {
        await pg.transaction(async (tx) => {
          // Create a temporary view with the query
          const formattedQuery =
            params && params.length > 0
              ? await formatQuery(pg, query, params, tx)
              : query
          await tx.exec(
            `CREATE OR REPLACE TEMP VIEW live_query_${id}_view AS ${formattedQuery}`,
          )

          // Get the tables used in the view and add triggers to notify when they change
          tables = await getTablesForView(tx, `live_query_${id}_view`)
          await addNotifyTriggersToTables(tx, tables, tableNotifyTriggersAdded)

          if (isWindowed) {
            await tx.exec(`
              PREPARE live_query_${id}_get(int, int) AS
              SELECT * FROM live_query_${id}_view
              LIMIT $1 OFFSET $2;
            `)
            await tx.exec(`
              PREPARE live_query_${id}_get_total_count AS
              SELECT COUNT(*) FROM live_query_${id}_view;
            `)
            totalCount = (
              await tx.query<{ count: number }>(
                `EXECUTE live_query_${id}_get_total_count;`,
              )
            ).rows[0].count
            results = {
              ...(await tx.query<T>(
                `EXECUTE live_query_${id}_get(${limit}, ${offset});`,
              )),
              offset,
              limit,
              totalCount,
            }
          } else {
            await tx.exec(`
              PREPARE live_query_${id}_get AS
              SELECT * FROM live_query_${id}_view;
            `)
            results = await tx.query<T>(`EXECUTE live_query_${id}_get;`)
          }
        })
      }
      await init()

      // Function to refresh the query
      const refresh = debounceMutex(
        async ({
          offset: newOffset,
          limit: newLimit,
        }: {
          offset?: number
          limit?: number
        } = {}) => {
          // We can optionally provide new offset and limit values to refresh with
          if (
            !isWindowed &&
            (newOffset !== undefined || newLimit !== undefined)
          ) {
            throw new Error(
              'offset and limit cannot be provided for non-windowed queries',
            )
          }
          if (
            (newOffset &&
              (typeof newOffset !== 'number' || isNaN(newOffset))) ||
            (newLimit && (typeof newLimit !== 'number' || isNaN(newLimit)))
          ) {
            throw new Error('offset and limit must be numbers')
          }
          offset = newOffset ?? offset
          limit = newLimit ?? limit

          const run = async (count = 0) => {
            if (callbacks.length === 0) {
              return
            }
            try {
              if (isWindowed) {
                // For a windowed query we defer the refresh of the total count until
                // after we have returned the results with the old total count. This
                // is due to a count(*) being a fairly slow query and we want to update
                // the rows on screen as quickly as possible.
                results = {
                  ...(await pg.query<T>(
                    `EXECUTE live_query_${id}_get(${limit}, ${offset});`,
                  )),
                  offset,
                  limit,
                  totalCount, // This is the old total count
                }
              } else {
                results = await pg.query<T>(`EXECUTE live_query_${id}_get;`)
              }
            } catch (e) {
              const msg = (e as Error).message
              if (
                msg.startsWith(`prepared statement "live_query_${id}`) &&
                msg.endsWith('does not exist')
              ) {
                // If the prepared statement does not exist, reset and try again
                // This can happen if using the multi-tab worker
                if (count > MAX_RETRIES) {
                  throw e
                }
                await init()
                run(count + 1)
              } else {
                throw e
              }
            }

            runResultCallbacks(callbacks, results)

            // Update the total count
            // If the total count has changed, refresh the query
            if (isWindowed) {
              const newTotalCount = (
                await pg.query<{ count: number }>(
                  `EXECUTE live_query_${id}_get_total_count;`,
                )
              ).rows[0].count
              if (newTotalCount !== totalCount) {
                console.log('newTotalCount', newTotalCount)
                // The total count has changed, refresh the query
                totalCount = newTotalCount
                refresh()
              }
            }
          }
          await run()
        },
      )

      // Setup the listeners
      const unsubList: Array<() => Promise<void>> = await Promise.all(
        tables!.map((table) =>
          pg.listen(
            `table_change__${table.schema_name}__${table.table_name}`,
            async () => {
              refresh()
            },
          ),
        ),
      )

      // Function to subscribe to the query
      const subscribe = (callback: (results: Results<T>) => void) => {
        if (dead) {
          throw new Error(
            'Live query is no longer active and cannot be subscribed to',
          )
        }
        callbacks.push(callback)
      }

      // Function to unsubscribe from the query
      // If no function is provided, unsubscribe all callbacks
      // If there are no callbacks, unsubscribe from the notify triggers
      const unsubscribe = async (callback?: (results: Results<T>) => void) => {
        if (callback) {
          callbacks = callbacks.filter((callback) => callback !== callback)
        } else {
          callbacks = []
        }
        if (callbacks.length === 0) {
          dead = true
          await Promise.all(unsubList.map((unsub) => unsub()))
          await pg.exec(`
            DROP VIEW IF EXISTS live_query_${id}_view;
            DEALLOCATE live_query_${id}_get;
          `)
        }
      }

      // If the signal has already been aborted, unsubscribe
      if (signal?.aborted) {
        await unsubscribe()
      } else {
        // Add an event listener to unsubscribe if the signal is aborted
        signal?.addEventListener(
          'abort',
          () => {
            unsubscribe()
          },
          { once: true },
        )
      }

      // Run the callback with the initial results
      runResultCallbacks(callbacks, results!)

      // Return the initial results
      return {
        initialResults: results!,
        subscribe,
        unsubscribe,
        refresh,
      } satisfies LiveQuery<T>
    },

    async changes<T>(
      query: string | LiveChangesOptions<T>,
      params?: any[] | null,
      key?: string,
      callback?: (changes: Array<Change<T>>) => void,
    ) {
      let signal: AbortSignal | undefined
      if (typeof query !== 'string') {
        signal = query.signal
        params = query.params
        key = query.key
        callback = query.callback
        query = query.query
      }
      if (!key) {
        throw new Error('key is required for changes queries')
      }
      let callbacks: Array<(changes: Array<Change<T>>) => void> = callback
        ? [callback]
        : []
      const id = uuid().replace(/-/g, '')
      let dead = false

      let tables: { table_name: string; schema_name: string }[]
      let stateSwitch: 1 | 2 = 1
      let changes: Results<Change<T>>

      const init = async () => {
        await pg.transaction(async (tx) => {
          // Create a temporary view with the query
          const formattedQuery = await formatQuery(pg, query, params, tx)
          await tx.query(
            `CREATE OR REPLACE TEMP VIEW live_query_${id}_view AS ${formattedQuery}`,
          )

          // Get the tables used in the view and add triggers to notify when they change
          tables = await getTablesForView(tx, `live_query_${id}_view`)
          await addNotifyTriggersToTables(tx, tables, tableNotifyTriggersAdded)

          // Get the columns of the view
          const columns = [
            ...(
              await tx.query<any>(`
                SELECT column_name, data_type, udt_name
                FROM information_schema.columns 
                WHERE table_name = 'live_query_${id}_view'
              `)
            ).rows,
            { column_name: '__after__', data_type: 'integer' },
          ]

          // Init state tables as empty temp table
          await tx.exec(`
            CREATE TEMP TABLE live_query_${id}_state1 (LIKE live_query_${id}_view INCLUDING ALL);
            CREATE TEMP TABLE live_query_${id}_state2 (LIKE live_query_${id}_view INCLUDING ALL);
          `)

          // Create Diff views and prepared statements
          for (const curr of [1, 2]) {
            const prev = curr === 1 ? 2 : 1
            await tx.exec(`
              PREPARE live_query_${id}_diff${curr} AS
              WITH
                prev AS (SELECT LAG("${key}") OVER () as __after__, * FROM live_query_${id}_state${prev}),
                curr AS (SELECT LAG("${key}") OVER () as __after__, * FROM live_query_${id}_state${curr}),
                data_diff AS (
                  -- INSERT operations: Include all columns
                  SELECT 
                    'INSERT' AS __op__,
                    ${columns
                      .map(
                        ({ column_name }) =>
                          `curr."${column_name}" AS "${column_name}"`,
                      )
                      .join(',\n')},
                    ARRAY[]::text[] AS __changed_columns__
                  FROM curr
                  LEFT JOIN prev ON curr.${key} = prev.${key}
                  WHERE prev.${key} IS NULL
                UNION ALL
                  -- DELETE operations: Include only the primary key
                  SELECT 
                    'DELETE' AS __op__,
                    ${columns
                      .map(({ column_name, data_type, udt_name }) => {
                        if (column_name === key) {
                          return `prev."${column_name}" AS "${column_name}"`
                        } else {
                          return `NULL${data_type === 'USER-DEFINED' ? `::${udt_name}` : ``} AS "${column_name}"`
                        }
                      })
                      .join(',\n')},
                      ARRAY[]::text[] AS __changed_columns__
                  FROM prev
                  LEFT JOIN curr ON prev.${key} = curr.${key}
                  WHERE curr.${key} IS NULL
                UNION ALL
                  -- UPDATE operations: Include only changed columns
                  SELECT 
                    'UPDATE' AS __op__,
                    ${columns
                      .map(({ column_name, data_type, udt_name }) =>
                        column_name === key
                          ? `curr."${column_name}" AS "${column_name}"`
                          : `CASE 
                              WHEN curr."${column_name}" IS DISTINCT FROM prev."${column_name}" 
                              THEN curr."${column_name}"
                              ELSE NULL${data_type === 'USER-DEFINED' ? `::${udt_name}` : ``}
                              END AS "${column_name}"`,
                      )
                      .join(',\n')},
                      ARRAY(SELECT unnest FROM unnest(ARRAY[${columns
                        .filter(({ column_name }) => column_name !== key)
                        .map(
                          ({ column_name }) =>
                            `CASE
                              WHEN curr."${column_name}" IS DISTINCT FROM prev."${column_name}" 
                              THEN '${column_name}' 
                              ELSE NULL 
                              END`,
                        )
                        .join(
                          ', ',
                        )}]) WHERE unnest IS NOT NULL) AS __changed_columns__
                  FROM curr
                  INNER JOIN prev ON curr.${key} = prev.${key}
                  WHERE NOT (curr IS NOT DISTINCT FROM prev)
                )
              SELECT * FROM data_diff;
            `)
          }
        })
      }

      await init()

      const refresh = debounceMutex(async () => {
        if (callbacks.length === 0 && changes) {
          return
        }
        let reset = false
        for (let i = 0; i < 5; i++) {
          try {
            await pg.transaction(async (tx) => {
              // Populate the state table
              await tx.exec(`
                INSERT INTO live_query_${id}_state${stateSwitch} 
                  SELECT * FROM live_query_${id}_view;
              `)

              // Get the changes
              changes = await tx.query<any>(
                `EXECUTE live_query_${id}_diff${stateSwitch};`,
              )

              // Switch state
              stateSwitch = stateSwitch === 1 ? 2 : 1

              // Truncate the old state table
              await tx.exec(`
                TRUNCATE live_query_${id}_state${stateSwitch};
              `)
            })
            break
          } catch (e) {
            const msg = (e as Error).message
            if (
              msg ===
              `relation "live_query_${id}_state${stateSwitch}" does not exist`
            ) {
              // If the state table does not exist, reset and try again
              // This can happen if using the multi-tab worker
              reset = true
              await init()
              continue
            } else {
              throw e
            }
          }
        }

        runChangeCallbacks(callbacks, [
          ...(reset
            ? [
                {
                  __op__: 'RESET' as const,
                },
              ]
            : []),
          ...changes!.rows,
        ])
      })

      // Setup the listeners
      const unsubList: Array<() => Promise<void>> = await Promise.all(
        tables!.map((table) =>
          pg.listen(
            `table_change__${table.schema_name}__${table.table_name}`,
            async () => refresh(),
          ),
        ),
      )

      // Function to subscribe to the query
      const subscribe = (callback: (changes: Array<Change<T>>) => void) => {
        if (dead) {
          throw new Error(
            'Live query is no longer active and cannot be subscribed to',
          )
        }
        callbacks.push(callback)
      }

      // Function to unsubscribe from the query
      const unsubscribe = async (
        callback?: (changes: Array<Change<T>>) => void,
      ) => {
        if (callback) {
          callbacks = callbacks.filter((callback) => callback !== callback)
        } else {
          callbacks = []
        }
        if (callbacks.length === 0) {
          dead = true
          await Promise.all(unsubList.map((unsub) => unsub()))
          await pg.exec(`
            DROP VIEW IF EXISTS live_query_${id}_view;
            DROP TABLE IF EXISTS live_query_${id}_state1;
            DROP TABLE IF EXISTS live_query_${id}_state2;
            DEALLOCATE live_query_${id}_diff1;
            DEALLOCATE live_query_${id}_diff2;
          `)
        }
      }

      // If the signal has already been aborted, unsubscribe
      if (signal?.aborted) {
        await unsubscribe()
      } else {
        // Add an event listener to unsubscribe if the signal is aborted
        signal?.addEventListener(
          'abort',
          () => {
            unsubscribe()
          },
          { once: true },
        )
      }

      // Run the callback with the initial changes
      await refresh()

      // Fields
      const fields = changes!.fields.filter(
        (field) =>
          !['__after__', '__op__', '__changed_columns__'].includes(field.name),
      )

      // Return the initial results
      return {
        fields,
        initialChanges: changes!.rows,
        subscribe,
        unsubscribe,
        refresh,
      } satisfies LiveChanges<T>
    },

    async incrementalQuery<T>(
      query: string | LiveIncrementalQueryOptions<T>,
      params?: any[] | null,
      key?: string,
      callback?: (results: Results<T>) => void,
    ) {
      let signal: AbortSignal | undefined
      if (typeof query !== 'string') {
        signal = query.signal
        params = query.params
        key = query.key
        callback = query.callback
        query = query.query
      }
      if (!key) {
        throw new Error('key is required for incremental queries')
      }
      let callbacks: Array<(results: Results<T>) => void> = callback
        ? [callback]
        : []
      const rowsMap: Map<any, any> = new Map()
      const afterMap: Map<any, any> = new Map()
      let lastRows: T[] = []
      let firstRun = true

      const {
        fields,
        unsubscribe: unsubscribeChanges,
        refresh,
      } = await namespaceObj.changes<T>(query, params, key, (changes) => {
        // Process the changes
        for (const change of changes) {
          const {
            __op__: op,
            __changed_columns__: changedColumns,
            ...obj
          } = change as typeof change & { [key: string]: any }
          switch (op) {
            case 'RESET':
              rowsMap.clear()
              afterMap.clear()
              break
            case 'INSERT':
              rowsMap.set(obj[key], obj)
              afterMap.set(obj.__after__, obj[key])
              break
            case 'DELETE': {
              const oldObj = rowsMap.get(obj[key])
              rowsMap.delete(obj[key])
              // null is the starting point, we don't delete it as another insert
              // may have happened thats replacing it
              if (oldObj.__after__ !== null) {
                afterMap.delete(oldObj.__after__)
              }
              break
            }
            case 'UPDATE': {
              const newObj = { ...(rowsMap.get(obj[key]) ?? {}) }
              for (const columnName of changedColumns) {
                newObj[columnName] = obj[columnName]
                if (columnName === '__after__') {
                  afterMap.set(obj.__after__, obj[key])
                }
              }
              rowsMap.set(obj[key], newObj)
              break
            }
          }
        }

        // Get the rows in order
        const rows: T[] = []
        let lastKey: any = null
        for (let i = 0; i < rowsMap.size; i++) {
          const nextKey = afterMap.get(lastKey)
          const obj = rowsMap.get(nextKey)
          if (!obj) {
            break
          }
          // Remove the __after__ key from the exposed row
          const cleanObj = { ...obj }
          delete cleanObj.__after__
          rows.push(cleanObj)
          lastKey = nextKey
        }
        lastRows = rows

        // Run the callbacks
        if (!firstRun) {
          runResultCallbacks(callbacks, {
            rows,
            fields,
          })
        }
      })

      firstRun = false
      runResultCallbacks(callbacks, {
        rows: lastRows,
        fields,
      })

      const subscribe = (callback: (results: Results<T>) => void) => {
        callbacks.push(callback)
      }

      const unsubscribe = async (callback?: (results: Results<T>) => void) => {
        if (callback) {
          callbacks = callbacks.filter((callback) => callback !== callback)
        } else {
          callbacks = []
        }
        if (callbacks.length === 0) {
          await unsubscribeChanges()
        }
      }

      if (signal?.aborted) {
        await unsubscribe()
      } else {
        signal?.addEventListener(
          'abort',
          () => {
            unsubscribe()
          },
          { once: true },
        )
      }

      return {
        initialResults: {
          rows: lastRows,
          fields,
        },
        subscribe,
        unsubscribe,
        refresh,
      } satisfies LiveQuery<T>
    },
  }

  return {
    namespaceObj,
  }
}

export const live = {
  name: 'Live Queries',
  setup,
} satisfies Extension

export type PGliteWithLive = PGliteInterface & {
  live: LiveNamespace
}

/**
 * Get a list of all the tables used in a view, recursively
 * @param tx a transaction or PGlite instance
 * @param viewName the name of the view
 * @returns list of tables used in the view
 */
async function getTablesForView(
  tx: Transaction | PGliteInterface,
  viewName: string,
): Promise<{ table_name: string; schema_name: string }[]> {
  const result = await tx.query<{
    table_name: string;
    schema_name: string;
  }>(
    `
      WITH RECURSIVE view_dependencies AS (
        -- Base case: Get the initial view's dependencies
        SELECT DISTINCT
          cl.relname AS dependent_name,
          n.nspname AS schema_name,
          cl.relkind = 'v' AS is_view
        FROM pg_rewrite r
        JOIN pg_depend d ON r.oid = d.objid
        JOIN pg_class cl ON d.refobjid = cl.oid
        JOIN pg_namespace n ON cl.relnamespace = n.oid
        WHERE
          r.ev_class = (
              SELECT oid FROM pg_class WHERE relname = $1 AND relkind = 'v'
          )
          AND d.deptype = 'n'

        UNION ALL

        -- Recursive case: Traverse dependencies for views
        SELECT DISTINCT
          cl.relname AS dependent_name,
          n.nspname AS schema_name,
          cl.relkind = 'v' AS is_view
        FROM view_dependencies vd
        JOIN pg_rewrite r ON vd.dependent_name = (
          SELECT relname FROM pg_class WHERE oid = r.ev_class AND relkind = 'v'
        )
        JOIN pg_depend d ON r.oid = d.objid
        JOIN pg_class cl ON d.refobjid = cl.oid
        JOIN pg_namespace n ON cl.relnamespace = n.oid
        WHERE d.deptype = 'n'
      )
      SELECT DISTINCT
        dependent_name AS table_name,
        schema_name
      FROM view_dependencies
      WHERE NOT is_view; -- Exclude intermediate views
    `,
    [viewName],
  )

  return result.rows.map((row) => ({
    table_name: row.table_name,
    schema_name: row.schema_name,
  }))
}

/**
 * Add triggers to tables to notify when they change
 * @param tx a transaction or PGlite instance
 * @param tables list of tables to add triggers to
 */
async function addNotifyTriggersToTables(
  tx: Transaction | PGliteInterface,
  tables: { table_name: string; schema_name: string }[],
  tableNotifyTriggersAdded: Set<string>,
) {
  const triggers = tables
    .filter(
      (table) =>
        !tableNotifyTriggersAdded.has(
          `${table.schema_name}_${table.table_name}`,
        ),
    )
    .map((table) => {
      return `
      CREATE OR REPLACE FUNCTION "_notify_${table.schema_name}_${table.table_name}"() RETURNS TRIGGER AS $$
      BEGIN
        PERFORM pg_notify('table_change__${table.schema_name}__${table.table_name}', '');
        RETURN NULL;
      END;
      $$ LANGUAGE plpgsql;
      CREATE OR REPLACE TRIGGER "_notify_trigger_${table.schema_name}_${table.table_name}"
      AFTER INSERT OR UPDATE OR DELETE ON "${table.schema_name}"."${table.table_name}"
      FOR EACH STATEMENT EXECUTE FUNCTION "_notify_${table.schema_name}_${table.table_name}"();
      `
    })
    .join('\n')
  if (triggers.trim() !== '') {
    await tx.exec(triggers)
  }
  tables.map((table) =>
    tableNotifyTriggersAdded.add(`${table.schema_name}_${table.table_name}`),
  )
}

const runResultCallbacks = <T>(
  callbacks: Array<(results: Results<T>) => void>,
  results: Results<T>,
) => {
  for (const callback of callbacks) {
    callback(results)
  }
}

const runChangeCallbacks = <T>(
  callbacks: Array<(changes: Array<Change<T>>) => void>,
  changes: Array<Change<T>>,
) => {
  for (const callback of callbacks) {
    callback(changes)
  }
}
