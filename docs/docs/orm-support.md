# ORM and Query Builder Support

The following ORMs and Query Builders are known to work properly with
PGlite:

## Prisma

[Prisma](https://prisma.io) is a modern, type-safe ORM for TypeScript and Node.js. Prisma includes built-in support for local development using PGlite via `prisma dev`.

### Local development with `prisma dev`

Prisma offers a local dev database powered by PGlite. Just run:

```bash
npx prisma init
npx prisma dev
```

This starts a local Prisma Postgres instance backed by PGlite. Copy the connection string shown in the CLI and use it as your `DATABASE_URL`:

```
DATABASE_URL="prisma+postgres://localhost:PORT/?api_key=__API_KEY__"
```

You can then define models in your `schema.prisma` and use Prisma Client and migrations as usual:

```prisma
model User {
  id    Int    @id @default(autoincrement())
  email String @unique
  name  String?
}
```

```bash
npx prisma db push
```

```ts
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

await prisma.user.create({
  data: { email: 'alice@example.com' },
})

const users = await prisma.user.findMany()
console.log(users)
```

See the [Prisma local dev docs](https://www.prisma.io/docs/postgres/database/local-development) for more details.

## Drizzle

[Drizzle](https://orm.drizzle.team) is a TypeScript ORM with support for many
databases, including PGlite. Features include:

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

See the [Drizzle documentation](https://orm.drizzle.team/docs/connect-pglite)
for more details.

## Knex.js

[Knex](https://knexjs.org/) is a stable, reliable Query Builder for various
database engines. Key features include:

- Query builder
- Schema builder
- Raw queries
- Database migration tool

To use Knex.js with PGlite, add knex and the third party [knex-pglite](https://github.com/czeidler/knex-pglite)
library to your project:

```bash
npm i @electric-sql/pglite knex knex-pglite
```

Then you can setup a regular Knex instance:

```javascript
import { knex } from 'knex'
import ClientPgLite from 'knex-pglite'

export const db = knex({
  client: ClientPgLite,
  dialect: 'postgres',
  connection: { connectionString: 'idb://my-database' },
})
```

Now you can check [Knex documentation](https://knexjs.org/guide/query-builder.html)
and [knex-pglite](https://github.com/czeidler/knex-pglite) documentation for
more details.

## Orange ORM

[Orange ORM](https://orange-orm.io) is a modern, TypeScript-first ORM that runs in Node.js, Bun, Deno and the browser. It follows the Active-Record pattern and ships with an expressive, LINQ-style query API. Key features include:

- Rich querying and deep filtering
- Active-Record-style change tracking
- Fully-typed models with **zero code-generation**
- Seamless integration with **PGlite** across runtimes

To use Orange ORM with PGlite, add [orange-orm](https://github.com/alfateam/orange-orm)
library to your project:

```bash
npm i @electric-sql/pglite orange-orm
```

```javascript
import orange from 'orange-orm'
const db = map.pglite('idb://my-db')

await db.query(`
  create table if not exists task (
    id uuid primary key default gen_random_uuid(),
    title text,
    done boolean
  )
`)

const map = orange.map((x) => ({
  task: x.table('task').map(({ column }) => ({
    id: column('id').uuid().primary(),
    title: column('title').string(),
    done: column('done').boolean(),
  })),
}))

await db.task.insert({ title: 'Write docs', done: false })

const tasks = await db.task.getAll({
  where: (x) => x.done.eq(false),
})
console.log(JSON.stringify(tasks))
```

## TypeORM

[TypeORM](https://typeorm.io/) is an ORM that can run in NodeJS, the Browser, and many other platforms. Key features include:

- Clean object-relational model
- Eager and lazy associations (relations)
- Automatic migration generation
- Elegant-syntax, flexible and powerful QueryBuilder.

To use TypeORM with PGlite, add the third party [typeorm-pglite](https://www.npmjs.com/package/typeorm-pglite)
library to your project:

```bash
npm i @electric-sql/pglite typeorm-pglite
```

typeorm-pglite works with TypeORM's existing postgres dialect. Just provide the PGliteDriver to the driver data source option:

```javascript
import { PGliteDriver, getPGliteInstance } from 'typeorm-pglite'
import { DataSource } from 'typeorm'

const PGliteDataSource = new DataSource({
  type: 'postgres',
  driver: new PGliteDriver().driver,
})

// You can access the internal PGlite instance using getPGliteInstance function
const pgliteDb = await getPGliteInstance()
```

Check [TypeORM documentation](https://typeorm.io/data-source)
and [typeorm-pglite](https://github.com/muraliprajapati/typeorm-pglite) documentation for
more details.

## MikroORM

[MikroORM](https://mikro-orm.io/) is a TypeScript ORM for Node.js based on Data Mapper, Unit of Work and Identity Map patterns. Key features include:

- Implicit Transactions
- Clean and Simple Entity Definition
- Modelling Relationships

To use MikroORM with PGlite, install the required dependencies, including the third-party library [mikro-orm-pglite](https://www.npmjs.com/package/mikro-orm-pglite):

```bash
npm i @electric-sql/pglite @mikro-orm/postgresql mikro-orm-pglite
```

Next, configure the `driver` option for MikroORM to use `PGliteDriver`:

```javascript
import { MikroORM } from '@mikro-orm/core'
import { PGliteDriver } from 'mikro-orm-pglite'

const orm = await MikroORM.init({
  driver: PGliteDriver,
  dbName: 'postgres',
})

await orm.close()
```

See the [MikroORM PGlite Driver documentation](https://github.com/harryplusplus/mikro-orm-pglite#readme) for more details.
