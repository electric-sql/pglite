import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'
import { generateCopyData, serializeCopyValue } from '../src/copy.js'

describe('COPY TEXT serializer', () => {
  describe('serializeCopyValue', () => {
    it('renders null/undefined as the \\N marker', () => {
      expect(serializeCopyValue(null)).toBe('\\N')
      expect(serializeCopyValue(undefined)).toBe('\\N')
    })

    it('renders booleans as t/f', () => {
      expect(serializeCopyValue(true)).toBe('t')
      expect(serializeCopyValue(false)).toBe('f')
    })

    it('renders numbers and bigints', () => {
      expect(serializeCopyValue(42)).toBe('42')
      expect(serializeCopyValue(-3.14)).toBe('-3.14')
      expect(serializeCopyValue(0)).toBe('0')
      expect(serializeCopyValue(123456789012345678901234567890n)).toBe(
        '123456789012345678901234567890',
      )
      expect(serializeCopyValue(NaN)).toBe('NaN')
      expect(serializeCopyValue(Infinity)).toBe('Infinity')
      expect(serializeCopyValue(-Infinity)).toBe('-Infinity')
    })

    it('escapes control characters and backslashes per CopyAttributeOutText', () => {
      expect(serializeCopyValue('a\tb')).toBe('a\\tb')
      expect(serializeCopyValue('a\nb')).toBe('a\\nb')
      expect(serializeCopyValue('a\rb')).toBe('a\\rb')
      expect(serializeCopyValue('back\\slash')).toBe('back\\\\slash')
      expect(serializeCopyValue('\b\f\v')).toBe('\\b\\f\\v')
      // A literal "\N" must not be mistaken for the NULL marker.
      expect(serializeCopyValue('\\N')).toBe('\\\\N')
    })

    it('leaves ordinary strings untouched', () => {
      expect(serializeCopyValue('hello world')).toBe('hello world')
      expect(serializeCopyValue('2021-01-01 00:00:00')).toBe(
        '2021-01-01 00:00:00',
      )
    })

    it('serializes 1-D arrays as Postgres array literals', () => {
      expect(serializeCopyValue([1, 2, 3])).toBe('{1,2,3}')
      expect(serializeCopyValue([true, false])).toBe('{t,f}')
      expect(serializeCopyValue([])).toBe('{}')
    })

    it('quotes array elements that need it (array_out rules)', () => {
      // empty string, comma, whitespace, braces, the literal NULL, quotes
      expect(serializeCopyValue(['', 'a,b', 'a b'])).toBe('{"","a,b","a b"}')
      expect(serializeCopyValue(['NULL', 'null', 'Null'])).toBe(
        '{"NULL","null","Null"}',
      )
      // A backslash inside an element is escaped once for array_out and again
      // for the COPY field: \  ->  \\  ->  \\\\
      expect(serializeCopyValue(['a"b'])).toBe('{"a\\\\"b"}')
    })

    it('represents NULL array elements as unquoted NULL', () => {
      expect(serializeCopyValue([1, null, 3])).toBe('{1,NULL,3}')
    })

    it('serializes nested (multi-dimensional) arrays', () => {
      expect(
        serializeCopyValue([
          [1, 2],
          [3, 4],
        ]),
      ).toBe('{{1,2},{3,4}}')
    })

    it('serializes parsed json/jsonb values back to JSON text', () => {
      expect(serializeCopyValue({ a: 1, b: [2, 3] })).toBe('{"a":1,"b":[2,3]}')
    })

    it('renders Uint8Array as bytea hex', () => {
      expect(serializeCopyValue(new Uint8Array([0xde, 0xad, 0xbe, 0xef]))).toBe(
        '\\\\xdeadbeef',
      )
    })
  })

  describe('generateCopyData', () => {
    it('joins fields with tabs and rows with newlines', () => {
      const rows = [
        { id: 1, name: 'a', done: true },
        { id: 2, name: 'b', done: false },
      ]
      expect(generateCopyData(rows, ['id', 'name', 'done'])).toBe(
        '1\ta\tt\n2\tb\tf',
      )
    })
  })

  // The strongest guarantee: feed the generated stream straight into a real
  // Postgres COPY and confirm every value round-trips.
  describe('round-trips through PGlite COPY FROM', () => {
    async function roundTrip(
      columnsDdl: string,
      columns: string[],
      rows: Record<string, unknown>[],
    ): Promise<Record<string, unknown>[]> {
      const pg = await PGlite.create()
      await pg.exec(`CREATE TABLE t (${columnsDdl});`)

      const columnTypes = Object.fromEntries(
        (
          await pg.query<{ column_name: string; udt_name: string }>(
            `SELECT column_name, udt_name FROM information_schema.columns
             WHERE table_name = 't'`,
          )
        ).rows.map((c) => [c.column_name, c.udt_name]),
      )

      const copyData = generateCopyData(rows, columns, columnTypes)
      const blob = new Blob([copyData], { type: 'text/plain' })
      await pg.query(
        `COPY t (${columns.map((c) => `"${c}"`).join(', ')})
         FROM '/dev/blob' WITH (FORMAT text)`,
        [],
        { blob },
      )

      const result = await pg.query<Record<string, unknown>>(
        `SELECT * FROM t ORDER BY id`,
      )
      await pg.close()
      return result.rows
    }

    it('round-trips scalar types', async () => {
      const rows = [
        {
          id: 1,
          flag: true,
          n: 42,
          big: 9007199254740993n,
          amount: '123.45',
          note: 'plain',
        },
        {
          id: 2,
          flag: false,
          n: -7,
          big: -1n,
          amount: '0.001',
          note: null,
        },
      ]
      const out = await roundTrip(
        'id int, flag boolean, n int, big bigint, amount numeric, note text',
        ['id', 'flag', 'n', 'big', 'amount', 'note'],
        rows,
      )
      // pglite returns int8 as bigint only when outside the safe-integer range,
      // otherwise as a number.
      expect(out).toEqual([
        {
          id: 1,
          flag: true,
          n: 42,
          big: 9007199254740993n,
          amount: '123.45',
          note: 'plain',
        },
        { id: 2, flag: false, n: -7, big: -1, amount: '0.001', note: null },
      ])
    })

    it('round-trips strings with delimiters, newlines and backslashes', async () => {
      const rows = [
        { id: 1, s: 'tab\there' },
        { id: 2, s: 'new\nline' },
        { id: 3, s: 'carriage\rreturn' },
        { id: 4, s: 'back\\slash and "quote", comma' },
        { id: 5, s: '\\N is not null' },
        { id: 6, s: '' },
      ]
      const out = await roundTrip('id int, s text', ['id', 's'], rows)
      expect(out).toEqual(rows)
    })

    it('round-trips array columns', async () => {
      const rows = [
        { id: 1, ints: [1, 2, 3], texts: ['a', 'b,c', 'd e'] },
        { id: 2, ints: [], texts: ['NULL', '', 'quote"here'] },
        { id: 3, ints: [10, null, 30], texts: null },
      ]
      const out = await roundTrip(
        'id int, ints int[], texts text[]',
        ['id', 'ints', 'texts'],
        rows,
      )
      expect(out).toEqual(rows)
    })

    it('round-trips multi-dimensional arrays', async () => {
      const rows = [
        {
          id: 1,
          grid: [
            [1, 2],
            [3, 4],
          ],
        },
      ]
      const out = await roundTrip('id int, grid int[][]', ['id', 'grid'], rows)
      expect(out).toEqual(rows)
    })

    it('round-trips json and jsonb', async () => {
      const rows = [
        { id: 1, doc: { a: 1, b: ['x', 'y'], c: null } },
        { id: 2, doc: [1, 2, { nested: true }] },
      ]
      const out = await roundTrip('id int, doc jsonb', ['id', 'doc'], rows)
      expect(out).toEqual(rows)
    })

    it('round-trips json/jsonb arrays (json[]) with mixed element shapes', async () => {
      const rows = [
        { id: 1, docs: [{ a: 1 }, [1, 2, 3], 'str', 42, true] },
        { id: 2, docs: null },
      ]
      const out = await roundTrip('id int, docs jsonb[]', ['id', 'docs'], rows)
      expect(out).toEqual(rows)
    })

    it('round-trips timestamps and uuids delivered as strings', async () => {
      const rows = [
        {
          id: 1,
          ts: '2021-01-01 12:34:56',
          uid: '00000000-0000-0000-0000-000000000001',
        },
      ]
      const out = await roundTrip(
        'id int, ts timestamp, uid uuid',
        ['id', 'ts', 'uid'],
        rows,
      )
      // pglite parses timestamps into Date objects; avoid asserting an exact
      // instant here since timestamp-without-tz parsing is locale dependent.
      expect(out[0].uid).toBe('00000000-0000-0000-0000-000000000001')
      expect(out[0].ts).toBeInstanceOf(Date)
    })

    it('round-trips bytea from a hex string and from Uint8Array', async () => {
      const rows = [
        { id: 1, b: '\\xdeadbeef' },
        { id: 2, b: new Uint8Array([0x01, 0x02, 0x03]) },
      ]
      const out = await roundTrip('id int, b bytea', ['id', 'b'], rows)
      expect(out).toEqual([
        { id: 1, b: new Uint8Array([0xde, 0xad, 0xbe, 0xef]) },
        { id: 2, b: new Uint8Array([0x01, 0x02, 0x03]) },
      ])
    })
  })
})
