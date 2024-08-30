# ORM Support

## Drizzle

[Drizzle](https://orm.drizzle.team) is a TypeScript ORM with support for many databases, including PGlite. Features include:

- A declarative relational query API
- An SQL-like query builder API
- Migrations

To use PGlite with Drizzle, wrap you PGlite instance with a `drizzle()` call:

```sh
npm i drizzle-orm @electric-sql/pglite
npm i -D drizzle-kit
```

```ts
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';

const client = new PGlite();
const db = drizzle(client);

await db.select().from(...);
```

See the [Drizzle documentation](https://orm.drizzle.team/docs/get-started-postgresql#pglite) for more details.

## TypeORM

To use PGlite with TypeORM, modify your `data-source.ts` as follows:

```ts
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { Post } from './entity/Post';
import { Category } from './entity/Category';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();

class LitePg {
  connection = this;
  on() {}
  release() {}
  removeListener() {}
  once(event, listener) {
    if (event === 'connect') {
      setImmediate(listener);
    }
  }
  end(callback) {
    if (callback) {
      setImmediate(callback);
    } else {
      return Promise.resolve();
    }
  }
  connect(callback) {
    if (callback) {
      setImmediate(callback, null, this, () => {});
    } else {
      return Promise.resolve(this);
    }
  }
  query(config, values, callback) {
    if (typeof values === 'function') {
      callback = values;
      values = undefined;
    }
    if (typeof config === 'string') {
      config = { text: config, values };
    }
    const resultPromise = db.query(config.text, config.values, {
      rowMode: config.rowMode,
      parsers: undefined, // Maybe convert from `config.types`?
    })
      .then((res) => {
        const { affectedRows, blob, ...result } = {
          ...res,
          command: '', // Unsupported
          rowCount: res.affectedRows,
        };
        return result;
      });
    if (!callback) {
      return resultPromise;
    }
    resultPromise.then((res) => callback(null, res), callback);
  }
}

const driver = {
  Pool: LitePg,
  Client: LitePg,
};

export const AppDataSource = new DataSource({
  type: 'postgres',
  driver,
  synchronize: true,
  logging: true,
  entities: [Post, Category],
});
```
