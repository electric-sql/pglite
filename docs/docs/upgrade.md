# Upgrading pglite from v0.2.x to v0.3.x

PGlite versions 0.2.x were based on PostgreSQL version 16.x, while PGlite version 0.3.x is based on PostgreSQL version 17.4. This is a BREAKING CHANGE as PostgreSQL does not maintain data store compatibility between major versions.

## Upgrade path

The upgrade path is to use [pg_dump](https://www.npmjs.com/package/@electric-sql/pglite-tools) to create a database dump from the previous version of PGlite and then import into a new instance based on 17.4.

## Using pg_dump to upgrade

::: code-group

```bash [npm]
### in a project that is using PGLite v0.2.x, also install PGlite v0.3.x
npm install pglite-03@npm:@electric-sql/pglite@0.3.0
```

```bash [pnpm]
### in a project that is using PGLite v0.2.x, also install PGlite v0.3.x
pnpm install pglite-03@npm:@electric-sql/pglite@0.3.0
```

```bash [yarn]
### in a project that is using PGLite v0.2.x, also install PGlite v0.3.x
yarn add pglite-03@npm:@electric-sql/pglite@0.3.0
```

```bash [bun]
### in a project that is using PGLite v0.2.x, also install PGlite v0.3.x
bun install pglite-03@npm:@electric-sql/pglite@0.3.0
```

:::

```ts
// in your upgrade code, you can then use your current PGlite
// version to dump the database:
import { PGlite } from '@electric-sql/pglite' // current version
import { PGlite as PGlite03 } from 'pglite-03' // next version

[...]

// pg02 is your PGlite instance with version 0.2.x
const currentVersion = await pg02.query<{ version: string }>(
  'SELECT version();'
)
console.log(currentVersion.rows[0].version)
// output should contain "PostgreSQL 16.4"

const dumpDir = await pg02.dumpDataDir('none')
const pgCurr = await PGlite.create({ loadDataDir: dumpDir })
const dumpResult = await pgDump({ pg02: pgCurr })

// pg03 is PGlite instance with version 0.3.x
const pg03 = await PGlite03.create()

pg03.exec(await dumpResult.text())
// adapt the SEARCH_PATH to your needs
await pg03.exec('SET SEARCH_PATH = public;')

const nextVersion = await pg03.query<{ version: string }>(
  'SELECT version();'
)
console.log(nextVersion.rows[0].version)
// output should contain "PostgreSQL 17.4"
```

That's it! Now you can remove the PGlite v0.2.x package from your project.

## Further reading

You can see a full upgrade example in Electric SQL's Linearlite example on [this branch](https://github.com/electric-sql/electric/tree/tudor/upgradePathPGlite). The relevant code is in `examples/linearlite` folder, see [MigrateModal.tsx] (https://github.com/electric-sql/electric/blob/tudor/upgradePathPGlite/examples/linearlite/src/components/MigrateModal.tsx).
