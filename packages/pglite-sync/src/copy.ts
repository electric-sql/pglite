/**
 * Serialization of JavaScript values into a PostgreSQL `COPY ... WITH (FORMAT
 * text)` stream.
 *
 * The Electric client parses the wire values it receives into native JS values
 * before they reach this module: `int2`/`int4`/`float4`/`float8` become
 * `number`, `int8` becomes `bigint`, `bool` becomes `boolean`, `json`/`jsonb`
 * become parsed objects/arrays, array columns become (possibly nested) JS
 * arrays, and every other type is left as its raw Postgres text representation
 * (a `string`). To feed those values back into `COPY` we have to reverse that:
 * turn each value into the exact text Postgres' input functions expect, then
 * apply the COPY framing.
 *
 * Rather than invent an escaping scheme (the previous CSV-based approach broke
 * on arrays, JSON, embedded delimiters, etc.) this is a faithful port of the
 * two relevant PostgreSQL backend routines:
 *
 *   - `CopyAttributeOutText`  (src/backend/commands/copyto.c) — field escaping
 *   - `array_out`             (src/backend/utils/adt/arrayfuncs.c) — array literals
 *
 * The TEXT format is used (not CSV) because it is what Postgres itself emits
 * internally, has a single well-defined escaping algorithm, and round-trips
 * every built-in type.
 */

// Defaults for COPY ... WITH (FORMAT text), matching the Postgres backend.
const DELIMITER = '\t'
const NULL_MARKER = '\\N'
const ROW_SEPARATOR = '\n'

// CopyAttributeOutText escapes the backslash, the field delimiter, and the
// control characters that have C-style escapes. Every other byte is emitted
// literally. Our delimiter is a tab, which already has a C-style escape, so the
// single map below covers all cases.
const COPY_TEXT_ESCAPES: Record<string, string> = {
  '\\': '\\\\',
  '\b': '\\b',
  '\f': '\\f',
  '\n': '\\n',
  '\r': '\\r',
  '\t': '\\t',
  '\v': '\\v',
}
const COPY_TEXT_ESCAPE_RE = /[\\\b\f\n\r\t\v]/g

/**
 * Escape an already-stringified field value per `CopyAttributeOutText`.
 */
function escapeCopyText(value: string): string {
  return value.replace(COPY_TEXT_ESCAPE_RE, (c) => COPY_TEXT_ESCAPES[c])
}

/**
 * Convert a Uint8Array to Postgres `bytea` hex-format text (`\xDEADBEEF`).
 * Electric normally delivers `bytea` already as such a string, so this only
 * matters for callers using a custom parser that yields binary.
 */
function byteaToText(bytes: Uint8Array): string {
  let hex = ''
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0')
  }
  return '\\x' + hex
}

/**
 * Render a JS `number` the way Postgres' float/int input accepts it. The only
 * special cases are the non-finite values, which Postgres spells out in words.
 */
function numberToText(value: number): string {
  if (Number.isNaN(value)) return 'NaN'
  if (value === Infinity) return 'Infinity'
  if (value === -Infinity) return '-Infinity'
  return String(value)
}

// array_out quotes an element when it is empty, looks like the literal NULL, or
// contains a brace, the element delimiter (comma), a double-quote, a backslash,
// or ASCII whitespace. We mirror `array_isspace`, which is stricter than JS
// `\s` (it excludes Unicode whitespace), to stay byte-for-byte compatible.
const ARRAY_NEEDS_QUOTE_RE = /[{}",\\ \t\n\r\v\f]/

/**
 * Quote/escape a single array element's text per `array_out`.
 */
function quoteArrayElement(text: string): string {
  const needsQuote =
    text.length === 0 ||
    text.toLowerCase() === 'null' ||
    ARRAY_NEEDS_QUOTE_RE.test(text)
  if (!needsQuote) return text
  // Inside quotes only `"` and `\` are escaped, each with a single backslash.
  return '"' + text.replace(/(["\\])/g, '\\$1') + '"'
}

/**
 * Build a Postgres array literal (`{...}`) from a JS array, recursing into
 * nested arrays for multi-dimensional arrays. NULL elements become an unquoted
 * `NULL`; nested arrays are emitted as bare `{...}` (never quoted), exactly as
 * `array_out` does.
 */
function arrayToText(arr: ReadonlyArray<unknown>): string {
  const elements = arr.map((el) => {
    if (el === null || el === undefined) return 'NULL'
    if (Array.isArray(el)) return arrayToText(el)
    return quoteArrayElement(valueToText(el))
  })
  return '{' + elements.join(',') + '}'
}

/**
 * Convert a non-null JS value to its bare Postgres text representation (before
 * COPY field escaping is applied). Dispatch is on the runtime type produced by
 * the Electric parser. `json`/`jsonb` columns are handled ahead of this by
 * `serializeCopyValue` when a column type is known; reaching the object branch
 * here is the type-less fallback.
 */
function valueToText(value: unknown): string {
  switch (typeof value) {
    case 'string':
      return value
    case 'number':
      return numberToText(value)
    case 'bigint':
      return value.toString()
    case 'boolean':
      return value ? 't' : 'f'
    case 'object': {
      if (Array.isArray(value)) return arrayToText(value)
      if (value instanceof Date) return value.toISOString()
      if (value instanceof Uint8Array) return byteaToText(value)
      if (value instanceof ArrayBuffer)
        return byteaToText(new Uint8Array(value))
      if (ArrayBuffer.isView(value)) {
        const v = value as ArrayBufferView
        return byteaToText(new Uint8Array(v.buffer, v.byteOffset, v.byteLength))
      }
      // json / jsonb arrive already parsed; re-serialize them.
      return JSON.stringify(value)
    }
    default:
      // Should be unreachable for Electric-parsed values; be defensive.
      return String(value)
  }
}

/**
 * Build a Postgres array literal from a `json[]`/`jsonb[]` value. Each element
 * is JSON text (re-serialized from the parsed value), so we cannot reuse the
 * generic array path: a JSON array element must stay JSON (`[1,2]`), not be
 * turned into a nested SQL array (`{1,2}`).
 */
function jsonArrayToText(arr: ReadonlyArray<unknown>): string {
  const elements = arr.map((el) =>
    el === null || el === undefined
      ? 'NULL'
      : quoteArrayElement(jsonToText(el)),
  )
  return '{' + elements.join(',') + '}'
}

/**
 * Re-serialize a parsed `json`/`jsonb` value to its JSON text form. Electric
 * delivers these columns already run through `JSON.parse`, so the value is the
 * decoded JS value (object, array, string, number, boolean or null) and always
 * needs `JSON.stringify` to become valid JSON input again — including scalars
 * (the string `hi` must be written as `"hi"`).
 */
function jsonToText(value: unknown): string {
  return JSON.stringify(value)
}

/**
 * Postgres `udt_name`s that need JSON-aware serialization rather than the
 * generic runtime-type dispatch. Used to resolve the otherwise undecidable
 * "is this JS array a SQL array or a JSON array?" ambiguity.
 */
const JSON_UDT_NAMES = new Set(['json', 'jsonb'])
const JSON_ARRAY_UDT_NAMES = new Set(['_json', '_jsonb'])

/**
 * Serialize a single value into one COPY TEXT field. `null`/`undefined` become
 * the NULL marker (`\N`); everything else is converted to text and escaped.
 *
 * `udtName` is the column's Postgres `udt_name` (from `information_schema`).
 * When supplied it disambiguates `json`/`jsonb` columns; when omitted the
 * value's runtime type is used (which cannot tell a `jsonb` array from a SQL
 * array).
 */
export function serializeCopyValue(value: unknown, udtName?: string): string {
  if (value === null || value === undefined) return NULL_MARKER
  if (udtName !== undefined) {
    if (JSON_UDT_NAMES.has(udtName)) return escapeCopyText(jsonToText(value))
    if (JSON_ARRAY_UDT_NAMES.has(udtName) && Array.isArray(value))
      return escapeCopyText(jsonArrayToText(value))
  }
  return escapeCopyText(valueToText(value))
}

/**
 * Serialize a list of row objects into the body of a `COPY ... FROM` request in
 * TEXT format. Columns are emitted in the given order, fields are tab
 * separated, and rows are newline separated.
 *
 * `columnTypes` optionally maps a column name to its Postgres `udt_name`; pass
 * it so `json`/`jsonb` columns serialize correctly.
 */
export function generateCopyData(
  rows: ReadonlyArray<Record<string, unknown>>,
  columns: ReadonlyArray<string>,
  columnTypes?: Readonly<Record<string, string | undefined>>,
): string {
  return rows
    .map((row) =>
      columns
        .map((column) => serializeCopyValue(row[column], columnTypes?.[column]))
        .join(DELIMITER),
    )
    .join(ROW_SEPARATOR)
}
