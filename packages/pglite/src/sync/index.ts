import type { Extension, PGliteInterface } from "../interface";
import { ShapeStream, Message, ChangeMessage, Offset } from "@electric-sql/next";

export interface ShapeDefinition {
  table: string;
}

export type MapColumnsMap = Record<string, string>;
export type MapColumnsFn = (message: ChangeMessage<any>) => Record<string, string>;
export type MapColumns = MapColumnsMap | MapColumnsFn;

export interface SyncInToOptions {
  key: string;
  table: string;
  shape: ShapeDefinition;
  mapColumns?: MapColumns;
}

export interface ElectricSyncOptions {
  baseUrl: string;
}

export interface ApplyMessageToTableOptions {
  pg: PGliteInterface;
  key: string;
  table: string;
  rawMessage: Message;
  mapColumns?: MapColumns;
}

async function applyMessageToTable({
  pg,
  key,
  table,
  rawMessage,
  mapColumns,
}: ApplyMessageToTableOptions) {
  console.log("applyMessageToTable", table, rawMessage);
  if (!(rawMessage as any).headers.action) return;
  const message = rawMessage as ChangeMessage<any>;
  pg.transaction(async (tx) => {
    if (message.headers.action === "insert") {
      const columns = Object.keys(message.value);
      await tx.query(
        `
          INSERT INTO "${table}"
          (${columns.map((s) => '"' + s + '"').join(", ")})
          VALUES
          (${columns.map((_v, i) => "$" + (i + 1)).join(", ")})
        `,
        columns.map((column) => message.value[column])
      );
    } else if (message.headers.action === "update") {
      // id column is the pk in current implementation:
      // https://github.com/electric-sql/electric-next/issues/65
      const columns = Object.keys(message.value).filter(
        (column) => column !== "id"
      );
      await tx.query(
        `
        UPDATE "${table}"
        SET ${columns.map((column, i) => '"' + column + '" = $' + (i + 1)).join(", ")}
        WHERE "id" = $${columns.length + 1}
      `,
        [...columns.map((column) => message.value[column]), message.value.id]
      );
    } else if (message.headers.action === "delete") {
      // id is currently a suffix after a / in the message.key
      const id = parseInt(message.key.split("/").pop() ?? "");
      await tx.query(
        `
          DELETE FROM "${table}"
          WHERE "id" = $1
        `,
        [id]
      );
    }
    tx.query(
      `
        UPDATE electric.shapes
        SET current_offset = $1, last_updated = $2
        WHERE key = $3
      `,
      [message.offset, new Date(), key]
    );
  });
}

async function createPlugin(pg: PGliteInterface, options: ElectricSyncOptions) {
  const baseUrl = options.baseUrl;

  const namespaceObj = {
    syncInTo: async ({ key, table, shape, mapColumns }: SyncInToOptions) => {
      let currentOffset: Offset = "-1";
      let shapeId: string | undefined;
      await pg.transaction(async (tx) => {
        const ret = await tx.query<{
          current_offset: Offset;
          shape_id: string;
        }>(
          "SELECT current_offset, shape_id FROM electric.shapes WHERE key = $1",
          [key]
        );
        if (ret.rows.length === 1) {
          currentOffset = ret.rows[0].current_offset;
          shapeId = ret.rows[0].shape_id;
        } else if (ret.rows.length === 1) {
          await tx.query(
            `
              INSERT INTO electric.shapes (key, shape, current_offset, last_updated)
              VALUES ($1, $2, $3, $4)
            `,
            [key, shape, currentOffset, new Date()]
          );
        } else {
          throw new Error("More than one shape record found");
        }
      });

      const url = `${baseUrl}/v1/${shape.table}`;
      const stream = new ShapeStream({
        url,
        shapeId,
        offset: currentOffset,
      });
      stream.subscribe(async (messages) => {
        for (const message of messages) {
          await applyMessageToTable({
            pg,
            key,
            table,
            rawMessage: message,
            mapColumns,
          });
        }
      });
      const unsubsribe = () => {
        stream.unsubscribeAll();
      };
      return {
        unsubsribe,
      };
    },
  };

  const init = async () => {
    pg.exec(`
      CREATE SCHEMA IF NOT EXISTS electric;
      CREATE TABLE IF NOT EXISTS electric.shapes (
        key TEXT PRIMARY KEY, -- local id for the shape
        shape_id TEXT NOT NULL,
        shape JSONB NOT NULL,
        current_offset TEXT NOT NULL,
        last_updated TIMESTAMPTZ NOT NULL
      );
    `);
  };

  const close = async () => {
    // TODO:
    // - close all streams
  }

  return {
    namespaceObj,
    init,
    close,
  };
}

export function electricSync(options: ElectricSyncOptions) {
  return {
    name: "ElectricSQL Sync",
    setup: async (pg: PGliteInterface, emscriptenOpts: any) => {
      const { namespaceObj, init } = await createPlugin(pg, options);
      return {
        namespaceObj,
        init,
      };
    },
  } satisfies Extension;
}
