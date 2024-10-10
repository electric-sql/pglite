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
} from './interface'
import { uuid, formatQuery } from '../utils.js'

export type {
  LiveNamespace,
  LiveQuery,
  LiveChanges,
  Change,
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
      if (typeof query !== 'string') {
        signal = query.signal
        params = query.params
        callback = query.callback
        query = query.query
      }
      let callbacks: Array<(results: Results<T>) => void> = callback
        ? [callback]
        : []
      const id = uuid().replace(/-/g, '')

      let results: Results<T>
      let tables: { table_name: string; schema_name: string }[]

      const runCallbacks = (results: Results<T>) => {
        for (const callback of callbacks) {
          callback(results)
        }
      }

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

          // Create prepared statement to get the results
          await tx.exec(`
            PREPARE live_query_${id}_get AS
            SELECT * FROM live_query_${id}_view;
          `)

          // Get the initial results
          results = await tx.query<T>(`EXECUTE live_query_${id}_get;`)
        })
      }
      await init()

      // Function to refresh the query
      const refresh = async (count = 0) => {
        if (callbacks.length === 0) {
          return
        }
        try {
          results = await pg.query<T>(`EXECUTE live_query_${id}_get;`)
        } catch (e) {
          const msg = (e as Error).message
          if (
            msg === `prepared statement "live_query_${id}_get" does not exist`
          ) {
            // If the prepared statement does not exist, reset and try again
            // This can happen if using the multi-tab worker
            if (count > MAX_RETRIES) {
              throw e
            }
            await init()
            refresh(count + 1)
          } else {
            throw e
          }
        }
        runCallbacks(results)
      }

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
          await Promise.all(unsubList.map((unsub) => unsub()))
          await pg.exec(`
            DROP VIEW IF EXISTS live_query_${id}_view;
            DEALLOCATE live_query_${id}_get;
          `)
        }
      }

      // Add an event listener to unsubscribe if the signal is aborted
      signal?.addEventListener('abort', () => {
        unsubscribe()
      })

      // If the signal has already been aborted, unsubscribe
      if (signal?.aborted) {
        await unsubscribe()
      }

      // Run the callback with the initial results
      runCallbacks(results!)

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

      let tables: { table_name: string; schema_name: string }[]
      let stateSwitch: 1 | 2 = 1
      let changes: Results<Change<T>>

      const runCallbacks = (changes: Array<Change<T>>) => {
        for (const callback of callbacks) {
          callback(changes)
        }
      }

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

      const refresh = async () => {
        if (callbacks.length === 0) {
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

        runCallbacks([
          ...(reset
            ? [
                {
                  __op__: 'RESET' as const,
                },
              ]
            : []),
          ...changes!.rows,
        ])
      }

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

      // Add an event listener to unsubscribe if the signal is aborted
      signal?.addEventListener('abort', () => {
        unsubscribe()
      })

      // If the signal has already been aborted, unsubscribe
      if (signal?.aborted) {
        await unsubscribe()
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

      const runCallbacks = (results: Results<T>) => {
        for (const callback of callbacks) {
          callback(results)
        }
      }

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
              afterMap.delete(oldObj.__after__)
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
          runCallbacks({
            rows,
            fields,
          })
        }
      })

      firstRun = false
      runCallbacks({
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

      signal?.addEventListener('abort', () => {
        unsubscribe()
      })

      if (signal?.aborted) {
        await unsubscribe()
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
  const tables = new Map<string, { table_name: string; schema_name: string }>()

  async function getTablesRecursive(currentViewName: string) {
    const result = await tx.query<{
      table_name: string
      schema_name: string
      is_view: boolean
    }>(
      `
        SELECT DISTINCT
          cl.relname AS table_name,
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
        AND d.deptype = 'n';
      `,
      [currentViewName],
    )

    for (const row of result.rows) {
      if (row.table_name !== currentViewName && !row.is_view) {
        const tableKey = `"${row.schema_name}"."${row.table_name}"`
        if (!tables.has(tableKey)) {
          tables.set(tableKey, {
            table_name: row.table_name,
            schema_name: row.schema_name,
          })
        }
      } else if (row.is_view) {
        await getTablesRecursive(row.table_name)
      }
    }
  }

  await getTablesRecursive(viewName)

  return Array.from(tables.values())
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
