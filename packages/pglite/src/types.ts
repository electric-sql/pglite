/*
Based on postgres.js types.js
https://github.com/porsager/postgres/blob/master/src/types.js
Published under the Unlicense:
https://github.com/porsager/postgres/blob/master/UNLICENSE 
*/

import type { ParserOptions } from './interface.js'

const JSON_parse = globalThis.JSON.parse
const JSON_stringify = globalThis.JSON.stringify

export const BOOL = 16,
  BYTEA = 17,
  CHAR = 18,
  INT8 = 20,
  INT2 = 21,
  INT4 = 23,
  REGPROC = 24,
  TEXT = 25,
  OID = 26,
  TID = 27,
  XID = 28,
  CID = 29,
  JSON = 114,
  XML = 142,
  PG_NODE_TREE = 194,
  SMGR = 210,
  PATH = 602,
  POLYGON = 604,
  CIDR = 650,
  FLOAT4 = 700,
  FLOAT8 = 701,
  ABSTIME = 702,
  RELTIME = 703,
  TINTERVAL = 704,
  CIRCLE = 718,
  MACADDR8 = 774,
  MONEY = 790,
  MACADDR = 829,
  INET = 869,
  ACLITEM = 1033,
  BPCHAR = 1042,
  VARCHAR = 1043,
  DATE = 1082,
  TIME = 1083,
  TIMESTAMP = 1114,
  TIMESTAMPTZ = 1184,
  INTERVAL = 1186,
  TIMETZ = 1266,
  BIT = 1560,
  VARBIT = 1562,
  NUMERIC = 1700,
  REFCURSOR = 1790,
  REGPROCEDURE = 2202,
  REGOPER = 2203,
  REGOPERATOR = 2204,
  REGCLASS = 2205,
  REGTYPE = 2206,
  UUID = 2950,
  TXID_SNAPSHOT = 2970,
  PG_LSN = 3220,
  PG_NDISTINCT = 3361,
  PG_DEPENDENCIES = 3402,
  TSVECTOR = 3614,
  TSQUERY = 3615,
  GTSVECTOR = 3642,
  REGCONFIG = 3734,
  REGDICTIONARY = 3769,
  JSONB = 3802,
  REGNAMESPACE = 4089,
  REGROLE = 4096

export const types = {
  string: {
    to: TEXT,
    from: [TEXT, VARCHAR, BPCHAR],
    serialize: (x: string | number) => {
      if (typeof x === 'string') {
        return x
      } else if (typeof x === 'number') {
        return x.toString()
      } else {
        throw new Error('Invalid input for string type')
      }
    },
    parse: (x: string) => x,
  },
  number: {
    to: 0,
    from: [INT2, INT4, OID, FLOAT4, FLOAT8, NUMERIC],
    serialize: (x: number) => x.toString(),
    parse: (x: string) => +x,
  },
  bigint: {
    to: INT8,
    from: [INT8],
    serialize: (x: bigint) => x.toString(),
    parse: (x: string) => {
      const n = BigInt(x)
      if (n < Number.MIN_SAFE_INTEGER || n > Number.MAX_SAFE_INTEGER) {
        return n // return BigInt
      } else {
        return Number(n) // in range of standard JS numbers so return number
      }
    },
  },
  json: {
    to: JSON,
    from: [JSON, JSONB],
    serialize: (x: any) => {
      if (typeof x === 'string') {
        return x
      } else {
        return JSON_stringify(x)
      }
    },
    parse: (x: string) => JSON_parse(x),
  },
  boolean: {
    to: BOOL,
    from: [BOOL],
    serialize: (x: boolean) => {
      if (typeof x !== 'boolean') {
        throw new Error('Invalid input for boolean type')
      }
      return x ? 't' : 'f'
    },
    parse: (x: string) => x === 't',
  },
  date: {
    to: TIMESTAMPTZ,
    from: [DATE, TIMESTAMP, TIMESTAMPTZ],
    serialize: (x: Date | string | number) => {
      if (typeof x === 'string') {
        return x
      } else if (typeof x === 'number') {
        return new Date(x).toISOString()
      } else if (x instanceof Date) {
        return x.toISOString()
      } else {
        throw new Error('Invalid input for date type')
      }
    },
    parse: (x: string | number) => new Date(x),
  },
  bytea: {
    to: BYTEA,
    from: [BYTEA],
    serialize: (x: Uint8Array) => {
      if (!(x instanceof Uint8Array)) {
        throw new Error('Invalid input for bytea type')
      }
      return (
        '\\x' +
        Array.from(x)
          .map((byte) => byte.toString(16).padStart(2, '0'))
          .join('')
      )
    },
    parse: (x: string): Uint8Array => {
      const hexString = x.slice(2)
      return Uint8Array.from({ length: hexString.length / 2 }, (_, idx) =>
        parseInt(hexString.substring(idx * 2, (idx + 1) * 2), 16),
      )
    },
  },
} satisfies TypeHandlers

export type Parser = (x: string, typeId?: number) => any
export type Serializer = (x: any) => string

export type TypeHandler = {
  to: number
  from: number | number[]
  serialize: Serializer
  parse: Parser
}

export type TypeHandlers = {
  [key: string]: TypeHandler
}

const defaultHandlers = typeHandlers(types)

export const parsers = defaultHandlers.parsers
export const serializers = defaultHandlers.serializers

export function parseType(
  x: string | null,
  type: number,
  parsers?: ParserOptions,
): any {
  if (x === null) {
    return null
  }
  const handler = parsers?.[type] ?? defaultHandlers.parsers[type]
  if (handler) {
    return handler(x, type)
  } else {
    return x
  }
}

function typeHandlers(types: TypeHandlers) {
  return Object.keys(types).reduce(
    ({ parsers, serializers }, k) => {
      const { to, from, serialize, parse } = types[k]
      serializers[to] = serialize
      serializers[k] = serialize
      parsers[k] = parse
      if (Array.isArray(from)) {
        from.forEach((f) => {
          parsers[f] = parse
          serializers[f] = serialize
        })
      } else {
        parsers[from] = parse
        serializers[from] = serialize
      }
      return { parsers, serializers }
    },
    {
      parsers: {} as {
        [key: number | string]: (x: string, typeId?: number) => any
      },
      serializers: {} as {
        [key: number | string]: Serializer
      },
    },
  )
}

const escapeBackslash = /\\/g
const escapeQuote = /"/g

function arrayEscape(x: string) {
  return x.replace(escapeBackslash, '\\\\').replace(escapeQuote, '\\"')
}

export function arraySerializer(
  xs: any,
  serializer: Serializer | undefined,
  typarray: number,
): string {
  if (Array.isArray(xs) === false) return xs

  if (!xs.length) return '{}'

  const first = xs[0]
  // Only _box (1020) has the ';' delimiter for arrays, all other types use the ',' delimiter
  const delimiter = typarray === 1020 ? ';' : ','

  if (Array.isArray(first)) {
    return `{${xs.map((x) => arraySerializer(x, serializer, typarray)).join(delimiter)}}`
  } else {
    return `{${xs
      .map((x) => {
        if (x === undefined) {
          x = null
          // TODO: Add an option to specify how to handle undefined values
        }
        return x === null
          ? 'null'
          : '"' + arrayEscape(serializer ? serializer(x) : x.toString()) + '"'
      })
      .join(delimiter)}}`
  }
}

const arrayParserState = {
  i: 0,
  char: null as string | null,
  str: '',
  quoted: false,
  last: 0,
  p: null as string | null,
}

export function arrayParser(x: string, parser: Parser, typarray: number) {
  arrayParserState.i = arrayParserState.last = 0
  return arrayParserLoop(arrayParserState, x, parser, typarray)[0]
}

function arrayParserLoop(
  s: typeof arrayParserState,
  x: string,
  parser: Parser | undefined,
  typarray: number,
): any[] {
  const xs = []
  // Only _box (1020) has the ';' delimiter for arrays, all other types use the ',' delimiter
  const delimiter = typarray === 1020 ? ';' : ','
  for (; s.i < x.length; s.i++) {
    s.char = x[s.i]
    if (s.quoted) {
      if (s.char === '\\') {
        s.str += x[++s.i]
      } else if (s.char === '"') {
        xs.push(parser ? parser(s.str) : s.str)
        s.str = ''
        s.quoted = x[s.i + 1] === '"'
        s.last = s.i + 2
      } else {
        s.str += s.char
      }
    } else if (s.char === '"') {
      s.quoted = true
    } else if (s.char === '{') {
      s.last = ++s.i
      xs.push(arrayParserLoop(s, x, parser, typarray))
    } else if (s.char === '}') {
      s.quoted = false
      s.last < s.i &&
        xs.push(parser ? parser(x.slice(s.last, s.i)) : x.slice(s.last, s.i))
      s.last = s.i + 1
      break
    } else if (s.char === delimiter && s.p !== '}' && s.p !== '"') {
      xs.push(parser ? parser(x.slice(s.last, s.i)) : x.slice(s.last, s.i))
      s.last = s.i + 1
    }
    s.p = s.char
  }
  s.last < s.i &&
    xs.push(
      parser ? parser(x.slice(s.last, s.i + 1)) : x.slice(s.last, s.i + 1),
    )
  return xs
}
