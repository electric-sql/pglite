import {
  BackendMessage,
  RowDescriptionMessage,
  DataRowMessage,
  CommandCompleteMessage,
  ReadyForQueryMessage,
} from "pg-protocol/src/messages.js";
import type { Results, Row } from "./index.ts";

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
          msg.fields.map((field, i) => [
            currentResultSet!.fields[i].name,
            field,
          ])
        )
      );
    }
  }

  return resultSets;
}
