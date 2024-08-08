import type { Extension, PGliteInterface } from "../interface";
import { ShapeStream, Message, ChangeMessage } from "@electric-sql/client";
import type { ShapeStreamOptions } from "@electric-sql/client";

export type MapColumnsMap = Record<string, string>;
export type MapColumnsFn = (message: ChangeMessage<any>) => Record<string, any>;
export type MapColumns = MapColumnsMap | MapColumnsFn;

export interface SyncShapeToTableOptions extends ShapeStreamOptions {
  table: string;
  mapColumns?: MapColumns;
  primaryKey: string[];
}

export interface ElectricSyncOptions {
  debug?: boolean;
}

async function createPlugin(pg: PGliteInterface, options: ElectricSyncOptions) {
  const debug = options.debug || false;
  const streams: Array<{
    stream: ShapeStream;
    aborter: AbortController;
  }> = [];

  const namespaceObj = {
    syncShapeToTable: async (options: SyncShapeToTableOptions) => {
      const aborter = new AbortController();
      if (options.signal) {
        // we new to have our own aborter to be able to abort the stream
        // but still accept the signal from the user
        options.signal.addEventListener("abort", () => {
          aborter.abort();
        });
      }
      const stream = new ShapeStream({
        ...options,
        signal: aborter.signal,
      });
      stream.subscribe(async (messages) => {
        if (debug) {
          console.log("sync messages received", messages);
        }
        for (const message of messages) {
          await applyMessageToTable({
            pg,
            rawMessage: message,
            table: options.table,
            mapColumns: options.mapColumns,
            primaryKey: options.primaryKey,
            debug,
          });
        }
      });
      streams.push({
        stream,
        aborter,
      });
      const unsubsribe = () => {
        stream.unsubscribeAll();
        aborter.abort();
      };
      return {
        unsubsribe,
      };
    },
  };

  const close = async () => {
    for (const { stream, aborter } of streams) {
      stream.unsubscribeAll();
      aborter.abort();
    }
  };

  return {
    namespaceObj,
    close,
  };
}

export function electricSync(options: ElectricSyncOptions) {
  return {
    name: "ElectricSQL Sync",
    setup: async (pg: PGliteInterface, emscriptenOpts: any) => {
      const { namespaceObj, close } = await createPlugin(pg, options);
      return {
        namespaceObj,
        close,
      };
    },
  } satisfies Extension;
}

function doMapColumns(
  mapColumns: MapColumns,
  message: ChangeMessage<any>,
): Record<string, any> {
  if (typeof mapColumns === "function") {
    return mapColumns(message);
  } else {
    const mappedColumns: Record<string, any> = {};
    for (const [key, value] of Object.entries(mapColumns)) {
      mappedColumns[key] = message.value[value];
    }
    return mappedColumns;
  }
}

interface ApplyMessageToTableOptions {
  pg: PGliteInterface;
  table: string;
  rawMessage: Message;
  mapColumns?: MapColumns;
  primaryKey: string[];
  debug: boolean;
}

async function applyMessageToTable({
  pg,
  table,
  rawMessage,
  mapColumns,
  primaryKey,
  debug,
}: ApplyMessageToTableOptions) {
  if (!(rawMessage as any).headers.action) return;
  const message = rawMessage as ChangeMessage<any>;
  const data = mapColumns ? doMapColumns(mapColumns, message) : message.value;
  if (message.headers.action === "insert") {
    if (debug) {
      console.log("inserting", data);
    }
    const columns = Object.keys(data);
    await pg.query(
      `
        INSERT INTO "${table}"
        (${columns.map((s) => '"' + s + '"').join(", ")})
        VALUES
        (${columns.map((_v, i) => "$" + (i + 1)).join(", ")})
      `,
      columns.map((column) => data[column]),
    );
  } else if (message.headers.action === "update") {
    if (debug) {
      console.log("updating", data);
    }
    const columns = Object.keys(data).filter(
      // we don't update the primary key, they are used to identify the row
      (column) => !primaryKey.includes(column),
    );
    await pg.query(
      `
        UPDATE "${table}"
        SET ${columns
          .map((column, i) => '"' + column + '" = $' + (i + 1))
          .join(", ")}
        WHERE ${primaryKey
          .map((column, i) => '"' + column + '" = $' + (columns.length + i + 1))
          .join(" AND ")}
      `,
      [
        ...columns.map((column) => data[column]),
        ...primaryKey.map((column) => data[column]),
      ],
    );
  } else if (message.headers.action === "delete") {
    if (debug) {
      console.log("deleting", data);
    }
    await pg.query(
      `
        DELETE FROM "${table}"
        WHERE ${primaryKey
          .map((column, i) => '"' + column + '" = $' + (i + 1))
          .join(" AND ")}
      `,
      [...primaryKey.map((column) => data[column])],
    );
  }
}
