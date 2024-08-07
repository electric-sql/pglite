---
outline: [2, 3]
---

# PGlite API

## Main Constructor

The main constructor is imported as:

```ts
import { PGlite } from "@electric-sql/pglite";
```

The preferred way to create a PGlite instance is with the `PGlite.create()` static method that returns a promise, resolving to the new PGlite instance. 

`await PGlite.create(dataDir: string, options: PGliteOptions)`<br />
`await PGlite.create(options: PGliteOptions)`

There are a couple of advantages to using the static method:

- This awaits the [`.waitReady`](#waitready) promise, ensuring that the database has been fully initialised.
- When using TypeScript and extensions, the returned PGlite instance will have the extensions namespace on its type. This is not possible with the standard constructor due to TypesScript limitations.

A new PGlite instance can also be created using the `new PGlite()` constructor.

`new PGlite(dataDir: string, options: PGliteOptions)`<br/>
`new PGlite(options: PGliteOptions)`

#### `dataDir`

Path to the directory for storing the Postgres database. You can provide a URI scheme for various storage backends:

- `file://` or unprefixed<br />
  File system storage, available in Node and Bun.
- `idb://`<br />
  [IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API) storage, available in the browser.
- `memory://`<br />
  In-memory ephemeral storage, available in all platforms.

#### `options`

- `dataDir: string`<br />
  The directory in which to store the Postgres database when not provided as the first argument.
- `debug: 1-5`<br />
  the Postgres debug level. Logs are sent to the console.
- `relaxedDurability: boolean`<br />
  Under relaxed durability mode, PGlite will not wait for flushes to storage to complete after each query before returning results. This is particularly useful when using the IndexedDB file system.
- `fs: Filesystem`<br />
  The alternative to providing a dataDir with a filesystem prefix is to initialise a `Filesystem` yourself and provide it here. See [Filesystems](./filesystems.md)
- `loadDataDir: Blob | File`<br />
  A tarball of a PGlite `datadir` to load when the database starts. This should be a tarball produced from the related [`.dumpDataDir()`](#dumpdatadir) method.
- `extensions: Extensions`<br />
  An object containing the extensions you wish to load.

#### `options.extensions`

PGlite and Postgres extensions are loaded into a PGLite instance on start, and can include both a WASM build of a Postgres extension and/or a PGlite client plugin.

The `options.extensions` parameter is an object of `namespace: extension` parings. The namespace is used to expose the PGlite client plugin included in the extension. An example of this is the [live queries](./live-queries.md) extension.  

```ts
import { PGlite } from "@electric-sql/pglite";
import { live } from "@electric-sql/pglite/live";
import { vector } from "@electric-sql/pglite/vector";

const pg = await PGlite.create({
  extensions: {
    live, // Live query extension, is a PGlite client plugin
    vector, // Postgres pgvector extension
  },
});

// The `live` namespace is added by the use of the 
// `live` key in the `extensions` object.
pg.live.query('...')
```

For information on how to develop a PGlite extension see [Extension Development](../extensions/development.md).

## Methods

### query

`.query<T>(query: string, params?: any[], options?: QueryOptions): Promise<Results<T>>`

Execute a single statement, optionally with parameters.

Uses the *extended query* Postgres wire protocol.

Returns single [result object](#results-objects).

##### Example

```ts
await pg.query(
  'INSERT INTO test (name) VALUES ($1);',
  [ 'test' ]
);
// { affectedRows: 1 },
```

##### Query Options

The `query` and `exec` methods take an optional `options` objects with the following parameters:

- `rowMode: "object" | "array"` <br />
  The returned row object type, either an object of `fieldName: value` mappings or an array of positional values. Defaults to `"object"`.
- `parsers: ParserOptions` <br />
  An object of type  `{[[pgType: number]: (value: string) => any;]}` mapping Postgres data type IDs to parser functions.  
  For convenience, the `pglite` package exports a constant for most common Postgres types:

  ```ts
  import { types } from "@electric-sql/pglite";
  await pg.query(`
    SELECT * FROM test WHERE name = $1;
  `, ["test"], {
    rowMode: "array",
    parsers: {
      [types.TEXT]: (value) => value.toUpperCase(),
    }
  });
  ```

- `blob: Blob | File` <br />
  Attach a `Blob` or `File` object to the query that can used with a `COPY FROM` command by using the virtual `/dev/blob` device, see [importing and exporting](#importing-and-exporting-with-copy-tofrom).

### exec

`.exec(query: string, options?: QueryOptions): Promise<Array<Results>>`

Execute one or more statements. *(note that parameters are not supported)*

This is useful for applying database migrations, or running multi-statement SQL that doesn't use parameters.

Uses the *simple query* Postgres wire protocol.

Returns array of [result objects](#results-objects); one for each statement.

##### Example

```ts
await pg.exec(`
  CREATE TABLE IF NOT EXISTS test (
    id SERIAL PRIMARY KEY,
    name TEXT
  );
  INSERT INTO test (name) VALUES ('test');
  SELECT * FROM test;
`);
// [
//   { affectedRows: 0 },
//   { affectedRows: 1 },
//   {
//     rows: [
//       { id: 1, name: 'test' }
//     ]
//     affectedRows: 0,
//     fields: [
//       { name: 'id', dataTypeID: '23' },
//       { name: 'name', dataTypeID: '25' },
//     ]
//   }
// ]
```

### transaction

`.transaction<T>(callback: (tx: Transaction) => Promise<T>)`

To start an interactive transaction, pass a callback to the transaction method. It is passed a `Transaction` object which can be used to perform operations within the transaction.

The transaction will be committed when the promise returned from your callback resolves, and automatically rolled back if the promise is rejected.

##### `Transaction` objects

- `tx.query<T>(query: string, params?: any[], options?: QueryOptions): Promise<Results<T>>`<br />
  The same as the main [`.query` method](#querytquery-string-params-any-promiseresultst).
- `tx.exec(query: string, options?: QueryOptions): Promise<Array<Results>>`<br />
  The same as the main [`.exec` method](#execquery-string-promisearrayresults).
- `tx.rollback()`<br />
  Rollback and close the current transaction.

##### Example

```ts
await pg.transaction(async (tx) => {
  await tx.query(
    'INSERT INTO test (name) VALUES ('$1');',
    [ 'test' ]
  );
  return await ts.query('SELECT * FROM test;');
});
```

### close

`.close(): Promise<void>`

Close the database, ensuring it is shut down cleanly.

### listen

`.listen(channel: string, callback: (payload: string) => void): Promise<void>`

Subscribe to a [pg_notify](https://www.postgresql.org/docs/current/sql-notify.html) channel. The callback will receive the payload from the notification.

Returns an unsubscribe function to unsubscribe from the channel.

##### Example

```ts
const unsub = await pg.listen('test', (payload) => {
  console.log('Received:', payload);
});
await pg.query("NOTIFY test, 'Hello, world!'");
```

### unlisten

`.unlisten(channel: string, callback?: (payload: string) => void): Promise<void>`

Unsubscribe from the channel. If a callback is provided it removes only that callback from the subscription. When no callback is provided, it unsubscribes all callbacks for the channel.

### onNotification

`onNotification(callback: (channel: string, payload: string) => void): () => void`

Add an event handler for all notifications received from Postgres.

**Note:** This does not subscribe to the notification; you will need to manually subscribe with `LISTEN channel_name`.

### offNotification

`offNotification(callback: (channel: string, payload: string) => void): void`

Remove an event handler for all notifications received from Postgres.

### dumpDataDir

`dumpDataDir(): Promise<File | Blob>`

Dump the Postgres `datadir` to a Gzipped tarball.

This can then be used in combination with the [`loadDataDir`](#options) option when starting PGlite to load a dumped database from storage.

::: tip NOTE

The datadir dump may not be compatible with other Postgres versions; it is only designed for importing back into PGlite.

:::

## Properties

### ready

`.ready` *`boolean (read only)`*

Whether the database is ready to accept queries.

### closed

`.closed` *`boolean (read only)`*

Whether the database is closed and no longer accepting queries.

### waitReady

`.waitReady` *`Promise<void>`*

Promise that resolves when the database is ready to use.

::: tip NOTE

Query methods will wait for the `waitReady` promise to resolve if called before the database has fully initialised, and so it is not necessary to wait for it explicitly.

:::

## `Results<T>` Objects

Result objects have the following properties:

- `rows: Row<T>[]`<br />
  The rows retuned by the query.

- `affectedRows?: number` <br />
  Count of the rows affected by the query. Note, this is *not* the count of rows returned, it is the number or rows in the database changed by the query.

- `fields: { name: string; dataTypeID: number }[]`<br />
  Field name and Postgres data type ID for each field returned.

- `blob: Blob` <br />
  A `Blob` containing the data written to the virtual `/dev/blob/` device by a `COPY TO` command. See [/dev/blob](#devblob).


## `Row<T>` Objects

Rows objects are a key / value mapping for each row returned by the query.

The `.query<T>()` method can take a TypeScript type describing the expected shape of the returned rows. 

::: tip NOTE

These types are not validated at run time, the result is only cast to the provided type.

:::

## /dev/blob

PGlite has support for importing and exporting via the SQL `COPY TO/FROM` command by using a virtual `/dev/blob` device.

To import a file, pass the `File` or `Blob` in the query options as `blob`, and copy from the `/dev/blob` device.

```ts
await pg.query("COPY my_table FROM '/dev/blob';", [], {
  blob: MyBlob
})
```

To export a table or query to a file, you just need to write to the `/dev/blob` device; the file will be returned as `blob` on the query results:

```ts
const ret = await pg.query("COPY my_table TO '/dev/blob';")
// ret.blob is a `Blob` object with the data from the copy.
```
