import type {
  Extension,
  ExtensionSetupResult,
  PGliteInterface,
} from "../interface";
import {
  ShapeStream,
  type ShapeDefinition,
  Message,
  ChangeMessage,
} from "@electric-sql/next";

export type { ShapeDefinition } from "@electric-sql/next";

export interface ElectricSyncOptions {
  baseUrl: string;
}

async function applyMessageToTable(
  pg: PGliteInterface,
  table: string,
  rawMessage: Message,
) {
  console.log("applyMessageToTable", table, rawMessage);
  if (!(rawMessage as any).headers.action) return;
  const message = rawMessage as ChangeMessage<any>;
  if (message.headers.action === "insert") {
    const columns = Object.keys(message.value);
    await pg.query(
      `
      INSERT INTO "${table}"
      (${columns.map((s) => '"' + s + '"').join(", ")})
      VALUES
      (${columns.map((_v, i) => "$" + (i + 1)).join(", ")})
    `,
      columns.map((column) => message.value[column]),
    );
  } else if (message.headers.action === "update") {
    // id column is the pk in current implementation:
    // https://github.com/electric-sql/electric-next/issues/65
    const columns = Object.keys(message.value).filter(
      (column) => column !== "id",
    );
    await pg.query(
      `
      UPDATE "${table}"
      SET ${columns.map((column, i) => '"' + column + '" = $' + (i + 1)).join(", ")}
      WHERE "id" = $${columns.length + 1}
    `,
      [...columns.map((column) => message.value[column]), message.value.id],
    );
  } else if (message.headers.action === "delete") {
    console.log("======== delete", message);
    // id is currently a suffix after a / in the message.key
    const id = parseInt(message.key.split("/").pop() ?? "");
    await pg.query(
      `
      DELETE FROM "${table}"
      WHERE "id" = $1
    `,
      [id],
    );
  }
}

async function createNamespaceObj(
  pg: PGliteInterface,
  options: ElectricSyncOptions,
) {
  const baseUrl = options.baseUrl;
  const namespaceObj = {
    sync: (shape: ShapeDefinition) => {
      const stream = new ShapeStream({
        shape,
        baseUrl,
      });
      stream.subscribe(async (messages) => {
        for (const message of messages) {
          await applyMessageToTable(pg, shape.table, message);
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
  return namespaceObj;
}

export function electricSync(options: ElectricSyncOptions) {
  return {
    name: "electricSync",
    setup: async (pg: PGliteInterface, emscriptenOpts: any) => {
      console.log("electricSync setup");
      const ret = {
        namespaceObj: await createNamespaceObj(pg, options),
      };
      console.log(ret);
      return ret;
    },
  } satisfies Extension;
}
