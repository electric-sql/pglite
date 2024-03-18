import {
  BackendMessage,
  RowDescriptionMessage,
  DataRowMessage,
  CommandCompleteMessage,
  ReadyForQueryMessage,
} from "pg-protocol/dist/messages.js";
import type { Results, Row } from "./index.js";
import { parseType } from "./types.js";

/**
 * This function is used to parse the results of either a simple or extended query.
 * https://www.postgresql.org/docs/current/protocol-flow.html#PROTOCOL-FLOW-SIMPLE-QUERY
 */
export function parseResults(messages: Array<BackendMessage>): Array<Results> {
  const resultSets: Results[] = [];
  let currentResultSet: Results | null = null;

  for (const msg of messages) {
    if (msg instanceof RowDescriptionMessage) {
      currentResultSet = {
        rows: [],
        fields: msg.fields.map((field) => ({
          name: field.name,
          dataTypeID: field.dataTypeID,
        })),
      };
      resultSets.push(currentResultSet);
    } else if (msg instanceof DataRowMessage && currentResultSet) {
      currentResultSet.rows.push(
        Object.fromEntries(
          // TODO: fix where column names are not unique, i.e. ?column?
          msg.fields.map((field, i) => [
            currentResultSet!.fields[i].name,
            parseType(field, currentResultSet!.fields[i].dataTypeID),
          ])
        )
      );
    } else if (msg instanceof CommandCompleteMessage) {
      if (currentResultSet) {
        currentResultSet.affectedRows = affectedRows(msg);
      }
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
  if (parts[0] === "INSERT" || parts[0] === "UPDATE" || parts[0] === "DELETE") {
    return parseInt(parts[2]);
  } else {
    return 0;
  }
}
