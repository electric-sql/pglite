# Upgrading between minor versions

Unlike patch version, minor version upgrades might introduce breaking changes. Here is how you can upgrade.

## Upgrade path

The upgrade path is to use [pg_dump](https://www.npmjs.com/package/@electric-sql/pglite-tools) to create a database dump from the previous version of PGlite and then import into a new instance.

## Using pg_dump to upgrade

::: code-group

```bash [npm]
### in a project that is using a previous minor PGLite version, also install the newer version
### for example, if your project was using v0.3.x, also install version 0.4.x in the same project
npm install pglite-04@npm:@electric-sql/pglite@0.4.0
```

```bash [pnpm]
### in a project that is using a previous minor PGLite version, also install the newer version
### for example, if your project was using v0.3.x, also install version 0.4.x in the same project
pnpm install pglite-04@npm:@electric-sql/pglite@0.4.0
```

```bash [yarn]
### in a project that is using a previous minor PGLite version, also install the newer version
### for example, if your project was using v0.3.x, also install version 0.4.x in the same project
yarn add pglite-04@npm:@electric-sql/pglite@0.4.0
```

```bash [bun]
### in a project that is using a previous minor PGLite version, also install the newer version
### for example, if your project was using v0.3.x, also install version 0.4.x in the same project
bun install pglite-04@npm:@electric-sql/pglite@0.4.0
```

:::

```ts
// in your upgrade code, you can then use your current PGlite
// version to dump the database:
import { PGlite } from '@electric-sql/pglite' // current version
import { PGlite as PGlite04 } from 'pglite-04' // next version

[...]

// pg03 is your PGlite instance with version 0.3.x
const currentVersion = await pg03.query<{ version: string }>(
  'SELECT version();'
)
console.log(currentVersion.rows[0].version)

const dumpDir = await pg03.dumpDataDir('none')
const pgCurr = await PGlite.create({ loadDataDir: dumpDir })
const dumpResult = await pgDump({ pg03: pgCurr })

// pg03 is PGlite instance with version 0.3.x
const pg03 = await PGlite04.create()

pg03.exec(await dumpResult.text())
// adapt the SEARCH_PATH to your needs
await pg03.exec('SET SEARCH_PATH = public;')

const nextVersion = await pg03.query<{ version: string }>(
  'SELECT version();'
)
console.log(nextVersion.rows[0].version)
```

That's it! Now you can remove the PGlite v0.3.x package from your project.

## Further reading

You can see a full upgrade example in Electric SQL's Linearlite example (from 0.2.x to 0.3.x) on [this branch](https://github.com/electric-sql/electric/tree/tudor/upgradePathPGlite). The relevant code is in `examples/linearlite` folder, see [MigrateModal.tsx] (https://github.com/electric-sql/electric/blob/tudor/upgradePathPGlite/examples/linearlite/src/components/MigrateModal.tsx).
