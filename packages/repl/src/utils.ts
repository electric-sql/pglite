import { type PGlite } from "@electric-sql/pglite";
import { describe } from "psql-describe";
import type { Results, Response } from "./types";

export async function runQuery(query: string, pg: PGlite, file?: File): Promise<Response> {
  if (query.trim().toLowerCase().startsWith("\\")) {
    return runDescribe(query, pg);
  }
  const start = performance.now();
  try {
    const result = await pg.exec(query, {
      rowMode: "array",
      blob: file,
    });
    const elapsed = performance.now() - start;
    result
      .filter((res) => res.blob)
      .forEach((res) => handleSaveFile(res.blob!));
    return {
      query,
      results: result as any[],
      time: elapsed,
    };
  } catch (err) {
    return {
      query,
      error: (err as Error).message,
      time: performance.now() - start,
    };
  }
}

export async function runDescribe(
  query: string,
  pg: PGlite
): Promise<Response> {
  const start = performance.now();
  let out: any;
  let ret: Results;
  const { promise, cancel: _cancel } = describe(
    query,
    "postgres",
    async (sql) => {
      ret = (await pg.exec(sql, { rowMode: "array" }))[0] as Results;
      return {
        rows: ret.rows,
        fields: ret.fields,
        rowCount: ret.rows.length,
      };
    },
    (output) => {
      out = output;
    }
  );
  await promise;
  const elapsed = performance.now() - start;

  if (!out) {
    return {
      query,
      error: "No output",
      time: elapsed,
    };
  } else if (typeof out === "string") {
    if (out.startsWith("ERROR:")) {
      return {
        query,
        error: out,
        time: elapsed,
      };
    } else {
      return {
        query,
        text: out,
        time: elapsed,
      };
    }
  } else {
    return {
      query,
      text: out.title,
      results: [ret!],
      time: elapsed,
    };
  }
}

export async function getSchema(pg: PGlite): Promise<Record<string, string[]>> {
  const ret = await pg.query<{
    schema: string;
    table: string;
    columns: string;
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
  `);
  const schema: Record<string, string[]> = {};
  for (const row of ret.rows) {
    schema[`${row.schema}.${row.table}`] = Array.isArray(row.columns)
      ? row.columns
      : row.columns.slice(1, -1).split(",");
  }
  return schema;
}

async function handleSaveFile(blob: Blob) {
  if ((window as any).showSaveFilePicker) {
    const handle = await showSaveFilePicker();
    const writable = await handle.createWritable();
    await writable.write(blob);
    writable.close();
  } else {
    const saveImg = document.createElement("a");
    saveImg.href = URL.createObjectURL(blob);
    saveImg.download = "pglite.out";
    saveImg.click();
    setTimeout(() => URL.revokeObjectURL(saveImg.href), 60000);
  }
}
