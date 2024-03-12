export const types = {
  string: {
    to: 25,
    from: [25],
    serialize: (x: string) => x,
    parse: (x: string) => x,
  },
  number: {
    to: 0,
    from: [21, 23, 26, 700, 701],
    serialize: (x: number) => x.toString(),
    parse: (x: string) => +x,
  },
  bigint: {
    to: 20,
    from: [20],
    js: [BigInt],
    serialize: (x: BigInt) => x.toString(),
    parse: (x: string) => BigInt(x),
  },
  json: {
    to: 114,
    from: [114, 3802],
    serialize: (x: any) => JSON.stringify(x),
    parse: (x: string) => JSON.parse(x),
  },
  boolean: {
    to: 16,
    from: [16],
    serialize: (x: boolean) => (x === true ? "t" : "f"),
    parse: (x: string) => x === "t",
  },
  date: {
    to: 1184,
    from: [1082, 1114, 1184],
    js: [Date],
    serialize: (x: Date | string | number) =>
      (x instanceof Date ? x : new Date(x)).toISOString(),
    parse: (x: string | number) => new Date(x),
  },
  bytea: {
    to: 17,
    from: [17],
    js: [Uint8Array, Buffer],
    serialize: (x: Uint8Array) => "\\x" + Buffer.from(x).toString("hex"),
    parse: (x: string): Uint8Array =>
      new Uint8Array(Buffer.from(x.slice(2), "hex").buffer),
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

export function parseType(x: string, type: number): any {
  const handler = defaultHandlers.parsers[type];
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
