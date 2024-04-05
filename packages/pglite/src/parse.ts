import {
  BackendMessage,
  RowDescriptionMessage,
  DataRowMessage,
  CommandCompleteMessage,
} from "pg-protocol/dist/messages.js";
import type { Results, QueryOptions } from "./interface.js";
import { parseType } from "./types.js";

/**
 * This function is used to parse the results of either a simple or extended query.
 * https://www.postgresql.org/docs/current/protocol-flow.html#PROTOCOL-FLOW-SIMPLE-QUERY
 */
export function parseResults(
  messages: Array<BackendMessage>,
  options?: QueryOptions,
): Array<Results> {
  const resultSets: Results[] = [];
  const currentResultSet: Results = { rows: [], fields: [] };

  for (const msg of messages) {
    if (msg instanceof RowDescriptionMessage) {
      currentResultSet.fields = msg.fields.map((field) => ({
        name: field.name,
        dataTypeID: field.dataTypeID,
      }));
    } else if (msg instanceof DataRowMessage && currentResultSet) {
      if (options?.rowMode === "array") {
        currentResultSet.rows.push(
          msg.fields.map((field, i) =>
            parseType(
              field,
              currentResultSet!.fields[i].dataTypeID,
              options?.parsers,
            ),
          ),
        );
      } else {
        // rowMode === "object"
        currentResultSet.rows.push(
          Object.fromEntries(
            msg.fields.map((field, i) => [
              currentResultSet!.fields[i].name,
              parseType(
                field,
                currentResultSet!.fields[i].dataTypeID,
                options?.parsers,
              ),
            ]),
          ),
        );
      }
    } else if (msg instanceof CommandCompleteMessage) {
      currentResultSet.affectedRows = affectedRows(msg);
      resultSets.push(currentResultSet);
    }
  }

  if (resultSets.length === 0) {
    resultSets.push({
      rows: [],
      fields: [],
    });
  }

  return resultSets;
}

function affectedRows(msg: CommandCompleteMessage): number {
  const parts = msg.text.split(" ");
  switch (parts[0]) {
    case "INSERT":
    case "UPDATE":
    case "DELETE":
      return parseInt(parts[1]);
    default:
      return 0;
  }
}
