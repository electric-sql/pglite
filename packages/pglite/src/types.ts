import type { ParserOptions } from "./interface.js";
import { Buffer } from "./polyfills/buffer.js";

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

export const arrayTypes = {
  1001: BYTEA,
  1002: CHAR,
  1016: INT8,
  1005: INT2,
  1007: INT4,
  1009: TEXT,
  1028: OID,
  199: JSON,
  1021: FLOAT4,
  1022: FLOAT8,
  1015: VARCHAR,
  3807: JSONB,
  1182: DATE,
  1115: TIMESTAMP,
  1116: TIMESTAMPTZ,
};

export const types = {
  string: {
    to: 0,
    from: [TEXT, VARCHAR],
    serialize: (x: string) => x,
    parse: (x: string) => x,
    forceTo: TEXT,
  },
  number: {
    to: 0,
    from: [INT2, INT4, OID, FLOAT4, FLOAT8],
    serialize: (x: number) => x.toString(),
    parse: (x: string) => +x,
    forceTo: (x: number) => {
      if (Number.isInteger(x)) {
        return INT8;
      } else {
        return FLOAT8;
      }
    },
  },
  bigint: {
    to: INT8,
    from: [INT8],
    js: [BigInt],
    serialize: (x: BigInt) => x.toString(),
    parse: (x: string) => {
      const n = BigInt(x);
      if (n < Number.MIN_SAFE_INTEGER || n > Number.MAX_SAFE_INTEGER) {
        return n; // return BigInt
      } else {
        return Number(n); // in range of standard JS numbers so return number
      }
    },
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
  array: {
    to: 0,
    from: Object.keys(arrayTypes).map((x) => +x),
    serialize: (x: any[]) => serializeArray(x),
    parse: (x: string, typeId?: number) => {
      let parser;
      if (typeId && typeId in arrayTypes) {
        parser = parsers[arrayTypes[typeId as keyof typeof arrayTypes]];
      }
      return parseArray(x, parser);
    },
  },
} satisfies TypeHandlers;

export type TypeHandler = {
  to: number;
  from: number | number[];
  js?: any;
  serialize: (x: any) => string;
  parse: (x: string, typeId?: number) => any;
  forceTo?: number | ((x: any) => number);
};

export type TypeHandlers = {
  [key: string]: TypeHandler;
};

const defaultHandlers = typeHandlers(types);

export const parsers = defaultHandlers.parsers;
export const serializers = defaultHandlers.serializers;
export const serializerInstanceof = defaultHandlers.serializerInstanceof;

export type Serializer = (x: any, setAllTypes?: boolean) => [string, number];

export function serializerFor(x: any): Serializer {
  if (Array.isArray(x)) {
    return serializers.array;
  }
  const handler = serializers[typeof x];
  if (handler) {
    return handler;
  }
  for (const [Type, handler] of serializerInstanceof) {
    if (x instanceof Type) {
      return handler;
    }
  }
  return serializers.json;
}

export function serializeType(
  x: any,
  setAllTypes = false,
): [string | null, number] {
  if (x === null || x === undefined) {
    return [null, 0];
  }
  return serializerFor(x)(x, setAllTypes);
}

function escapeElement(elementRepresentation: string) {
  const escaped = elementRepresentation
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
  return '"' + escaped + '"';
}

function serializeArray(x: any[]) {
  let result = "{";
  for (let i = 0; i < x.length; i++) {
    if (i > 0) {
      result = result + ",";
    }
    if (x[i] === null || typeof x[i] === "undefined") {
      result = result + "NULL";
    } else if (Array.isArray(x[i])) {
      result = result + serializeArray(x[i]);
    } else if (ArrayBuffer.isView(x[i])) {
      let item = x[i];
      if (!(item instanceof Buffer)) {
        const buf = Buffer.from(item.buffer, item.byteOffset, item.byteLength);
        if (buf.length === item.byteLength) {
          item = buf;
        } else {
          item = buf.slice(item.byteOffset, item.byteOffset + item.byteLength);
        }
      }
      result += "\\\\x" + item.toString("hex");
    } else {
      result += escapeElement(serializeType(x[i])[0]!);
    }
  }
  result = result + "}";
  return result;
}

export function parseArray(value: string, parser?: (s: string) => any) {
  let i = 0;
  let char = null;
  let str = "";
  let quoted = false;
  let last = 0;
  let p: string | undefined = undefined;

  function loop(x: string): any[] {
    const xs = [];
    for (; i < x.length; i++) {
      char = x[i];
      if (quoted) {
        if (char === "\\") {
          str += x[++i];
        } else if (char === '"') {
          xs.push(parser ? parser(str) : str);
          str = "";
          quoted = x[i + 1] === '"';
          last = i + 2;
        } else {
          str += char;
        }
      } else if (char === '"') {
        quoted = true;
      } else if (char === "{") {
        last = ++i;
        xs.push(loop(x));
      } else if (char === "}") {
        quoted = false;
        last < i &&
          xs.push(parser ? parser(x.slice(last, i)) : x.slice(last, i));
        last = i + 1;
        break;
      } else if (char === "," && p !== "}" && p !== '"') {
        xs.push(parser ? parser(x.slice(last, i)) : x.slice(last, i));
        last = i + 1;
      }
      p = char;
    }
    last < i &&
      xs.push(parser ? parser(x.slice(last, i + 1)) : x.slice(last, i + 1));
    return xs;
  }

  return loop(value)[0];
}

export function parseType(
  x: string,
  type: number,
  parsers?: ParserOptions,
): any {
  if (x === null) {
    return null;
  }
  const handler = parsers?.[type] ?? defaultHandlers.parsers[type];
  if (handler) {
    return handler(x, type);
  } else {
    return x;
  }
}

function typeHandlers(types: TypeHandlers) {
  return Object.keys(types).reduce(
    ({ parsers, serializers, serializerInstanceof }, k) => {
      const { to, from, serialize, parse = null, forceTo } = types[k];
      const theSerializer = (x: any, setAllTypes = false) => {
        return [
          serialize(x),
          setAllTypes && forceTo
            ? typeof forceTo === "function"
              ? forceTo(x)
              : forceTo
            : to,
        ] as [string, number];
      };
      serializers[to] = theSerializer;
      serializers[k] = theSerializer;
      if (types[k].js) {
        types[k].js.forEach((Type: any) =>
          serializerInstanceof.push([Type, theSerializer]),
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
      parsers: {} as {
        [key: number | string]: (x: string, typeId?: number) => any;
      },
      serializers: {} as {
        [key: number | string]: Serializer;
      },
      serializerInstanceof: [] as Array<[any, Serializer]>,
    },
  );
}
