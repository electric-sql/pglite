import type { ParserOptions } from "./interface.js";

const JSON_parse = globalThis.JSON.parse;
const JSON_stringify = globalThis.JSON.stringify;

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
  REGROLE = 4096;

export const types = {
  string: {
    to: TEXT,
    from: [TEXT, VARCHAR],
    serialize: (x: string) => x,
    parse: (x: string) => x,
  },
  number: {
    to: 0,
    from: [INT2, INT4, OID, FLOAT4, FLOAT8],
    serialize: (x: number) => x.toString(),
    parse: (x: string) => +x,
  },
  bigint: {
    to: INT8,
    from: [INT8],
    js: [BigInt],
    serialize: (x: BigInt) => x.toString(),
    parse: (x: string) => BigInt(x),
  },
  json: {
    to: JSON,
    from: [JSON, JSONB],
    serialize: (x: any) => JSON_stringify(x),
    parse: (x: string) => JSON_parse(x),
  },
  boolean: {
    to: BOOL,
    from: [BOOL],
    serialize: (x: boolean) => (x === true ? "t" : "f"),
    parse: (x: string) => x === "t",
  },
  date: {
    to: 1184,
    from: [DATE, TIMESTAMP, TIMESTAMPTZ],
    js: [Date],
    serialize: (x: Date | string | number) =>
      (x instanceof Date ? x : new Date(x)).toISOString(),
    parse: (x: string | number) => new Date(x),
  },
  bytea: {
    to: BYTEA,
    from: [BYTEA],
    js: [Uint8Array, Buffer],
    serialize: (x: Uint8Array) => "\\x" + Buffer.from(x).toString("hex"),
    parse: (x: string): Uint8Array =>
      new Uint8Array(Buffer.from(x.slice(2), "hex")),
  },
} satisfies TypeHandlers;

export type TypeHandler = {
  to: number;
  from: number | number[];
  js?: any;
  serialize: (x: any) => string;
  parse: (x: string) => any;
};

export type TypeHandlers = {
  [key: string]: TypeHandler;
};

const defaultHandlers = typeHandlers(types);

export const parsers = defaultHandlers.parsers;
export const serializers = defaultHandlers.serializers;
export const serializerInstanceof = defaultHandlers.serializerInstanceof;

export function serializeType(x: any): [string, number] {
  const handler = serializers[typeof x];
  if (handler) {
    return handler(x);
  } else {
    for (const [Type, handler] of serializerInstanceof) {
      if (x instanceof Type) {
        return handler(x);
      }
    }
    return serializers.json(x);
  }
}

export function parseType(
  x: string,
  type: number,
  parsers?: ParserOptions
): any {
  const handler = parsers?.[type] ?? defaultHandlers.parsers[type];
  if (handler) {
    return handler(x);
  } else {
    return x;
  }
}

function typeHandlers(types: TypeHandlers) {
  return Object.keys(types).reduce(
    ({ parsers, serializers, serializerInstanceof }, k) => {
      const { to, from, serialize, parse = null } = types[k];
      const theSerializer = (x: any) => [serialize(x), to] as [string, number];
      serializers[to] = theSerializer;
      serializers[k] = theSerializer;
      if (types[k].js) {
        types[k].js.forEach((Type: any) =>
          serializerInstanceof.push([Type, theSerializer])
        );
      }
      if (parse) {
        if (Array.isArray(from)) {
          from.forEach((f) => (parsers[f] = parse));
        } else {
          parsers[from] = parse;
        }
        parsers[k] = parse;
      }
      return { parsers, serializers, serializerInstanceof };
    },
    {
      parsers: {} as { [key: number | string]: (x: string) => any },
      serializers: {} as {
        [key: number | string]: (x: any) => [string, number];
      },
      serializerInstanceof: [] as Array<[any, (x: any) => [string, number]]>,
    }
  );
}
