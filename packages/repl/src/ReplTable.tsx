import { useState, useEffect } from "react";
import type { Results } from "./types";

const tableRowIncrement = 100;
const maxCellLength = 200;

function cellClass(value: any) {
  if (value === null) {
    return "PGliteRepl-null";
  } else if (typeof value === "number") {
    return "PGliteRepl-number";
  } else if (typeof value === "boolean") {
    return "PGliteRepl-boolean";
  } else {
    return "";
  }
}

function cellValue(value: any) {
  let str: string;
  if (value === null) {
    str = "null";
  } else if (typeof value === "number") {
    str = value.toString();
  } else if (typeof value === "boolean") {
    str = value ? "true" : "false";
  } else if (value instanceof Date) {
    str = value.toISOString();
  } else if (Array.isArray(value)) {
    str = `[${value.map(cellValue).join(", ")}]`;
  } else if (typeof value === "object") {
    str = JSON.stringify(value);
  } else if (ArrayBuffer.isView(value)) {
    str = `${value.byteLength} bytes`;
  } else {
    str = value.toString();
  }
  return str.length > maxCellLength ? str.slice(0, maxCellLength) + "…" : str;
}

export function ReplTable({ result }: { result: Results }) {
  const [maxRows, setMaxRows] = useState(tableRowIncrement);
  const rows = result.rows.slice(0, maxRows);

  useEffect(() => {
    // Reset maxRows when the result changes
    setMaxRows(tableRowIncrement);
  }, [result]);

  const showMore = () => {
    setMaxRows((prev) => prev + tableRowIncrement);
  };

  return (
    <>
      <div className="PGliteRepl-table-scroll">
        <table className="PGliteRepl-table">
          <thead>
            <tr>
              {result.fields.map((col, i) => (
                <th key={i}>{col.name}</th>
              ))}
            </tr>
            {/* <tr>
              {result.fields.map((col, i) => (
                <th key={i}>{col.dataTypeID}</th>
              ))}
            </tr> */}
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                {row.map((col, j) => (
                  <td key={j} className={cellClass(col)}>
                    {cellValue(col)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="PGliteRepl-table-row-count">
        {result.rows.length > maxRows ? `${maxRows} of ` : ""}
        {result.rows.length} rows{" "}
        {result.rows.length > maxRows && (
          <a
            href=""
            onClick={(e) => {
              e.preventDefault();
              showMore();
            }}
          >
            Show more
          </a>
        )}
      </div>
    </>
  );
}
