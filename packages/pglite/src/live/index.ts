import type {
  Extension,
  PGliteInterface,
  Results,
  Transaction,
} from "../interface";

// Counter use to generate unique IDs for live queries
// This is used to create temporary views and so are scoped to the current connection
let liveQueryCounter = 0;

// The notify triggers are only ever added and never removed
// Keep track of which triggers have been added to avoid adding them multiple times
const tableNotifyTriggersAdded = new Set<string>();

interface LiveNamespace {
  /**
   * Create a live query
   * @param query - The query to run
   * @param params - The parameters to pass to the query
   * @param callback - A callback to run when the query is updated
   * @returns A promise that resolves to an object with the initial results,
   * an unsubscribe function, and a refresh function
   */
  query<T>(
    query: string,
    params?: any[],
    callback?: (results: Results<T>) => void
  ): Promise<LiveQueryReturn<T>>;
}

interface LiveQueryReturn<T> {
  initialResults: Results<T>;
  unsubscribe: () => Promise<void>;
  refresh: () => Promise<void>;
}

const setup = async (pg: PGliteInterface, emscriptenOpts: any) => {
  const namespaceObj: LiveNamespace = {
    async query<T>(
      query: string,
      params: any[] | undefined | null,
      callback: (results: Results<T>) => void
    ) {
      const id = liveQueryCounter++;

      let results: Results<T>;
      let tables: { table_name: string; schema_name: string }[];

      await pg.transaction(async (tx) => {
        // Create a temporary view with the query
        await tx.query(
          `CREATE OR REPLACE TEMP VIEW live_query_${id}_view AS ${query}`,
          params ?? []
        );

        // Get the tables used in the view and add triggers to notify when they change
        tables = await getTablesForView(tx, `live_query_${id}_view`);
        await addNotifyTriggersToTables(tx, tables);

        // Get the initial results
        results = await tx.query<T>(`SELECT * FROM live_query_${id}_view`);
      });

      // Function to refresh the query
      const refresh = async () => {
        results = await pg.query<T>(`SELECT * FROM live_query_${id}_view`);
        callback(results);
      };

      // Setup the listeners
      const unsubList: Array<() => Promise<void>> = [];
      for (const table of tables!) {
        const unsub = await pg.listen(
          `table_change__${table.schema_name}__${table.table_name}`,
          async () => {
            refresh();
          }
        );
        unsubList.push(unsub);
      }

      // Function to unsubscribe from the query
      const unsubscribe = async () => {
        for (const unsub of unsubList) {
          await unsub();
        }
        await pg.exec(`DROP VIEW IF EXISTS live_query_${id}_view`);
      };

      // Run the callback with the initial results
      callback(results!);

      // Return the initial results
      return {
        initialResults: results!,
        unsubscribe,
        refresh,
      };
    },
  };

  return {
    namespaceObj,
  };
};

export const live = {
  name: "Live Queries",
  setup,
} satisfies Extension;

/**
 * Get a list of all the tables used in a view
 * @param tx a transaction or or PGlite instance
 * @param viewName the name of the view
 * @returns list of tables used in the view
 */
async function getTablesForView(
  tx: Transaction | PGliteInterface,
  viewName: string
): Promise<{ table_name: string; schema_name: string }[]> {
  return (
    await tx.query<{
      table_name: string;
      schema_name: string;
    }>(
      `
        SELECT DISTINCT
          cl.relname AS table_name,
          n.nspname AS schema_name
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
      [viewName]
    )
  ).rows.filter((row) => row.table_name !== viewName);
}

/**
 * Add triggers to tables to notify when they change
 * @param tx a transaction or PGlite instance
 * @param tables list of tables to add triggers to
 */
async function addNotifyTriggersToTables(
  tx: Transaction | PGliteInterface,
  tables: { table_name: string; schema_name: string }[]
) {
  const triggers = tables
    .filter((table) =>
      tableNotifyTriggersAdded.has(`${table.schema_name}_${table.table_name}`)
    )
    .map((table) => {
      return `
      CREATE OR REPLACE FUNCTION _notify_${table.schema_name}_${table.table_name}() RETURNS TRIGGER AS $$
      BEGIN
        PERFORM pg_notify('table_change__${table.schema_name}__${table.table_name}', '');
        RETURN NULL;
      END;
      $$ LANGUAGE plpgsql;
      CREATE OR REPLACE TRIGGER _notify_trigger_${table.schema_name}_${table.table_name}
      AFTER INSERT OR UPDATE OR DELETE ON ${table.schema_name}.${table.table_name}
      FOR EACH STATEMENT EXECUTE FUNCTION _notify_${table.schema_name}_${table.table_name}();
      `;
    })
    .join("\n");
  await tx.exec(triggers);
  tables.map((table) =>
    tableNotifyTriggersAdded.add(`${table.schema_name}_${table.table_name}`)
  );
}
