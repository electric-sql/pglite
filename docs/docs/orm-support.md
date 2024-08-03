# ORM Support

## Drizzle

[Drizzle](https://orm.drizzle.team) is a TypeScript ORM with support for many datbases include PGlite. Features include:

- A declarative realtional query API
- An SQL-like query builder API
- Migrations

To use PGlite with Drizzle just wrap you PGlite instance with a `drizzle()` call:

```sh
npm i drizzle-orm @electric-sql/pglite
npm i -D drizzle-kit
```

```ts
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';

const client = new PGlite();
const db = drizzle(client);

await db.select().from(users);
```

See the [Drizzle documentation](https://orm.drizzle.team/docs/get-started-postgresql#pglite) for more details.
