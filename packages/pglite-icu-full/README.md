# pglite-icu-full

A package containing all the resources from [libicu](https://github.com/unicode-org/icu) that can be used with PGlite to build localized applications.

## Installation

```bash
npm install @electric-sql/pglite-icu-full
# or
yarn add @electric-sql/pglite-icu-full
# or
pnpm add @electric-sql/pglite-icu-full
```

## Usage

This loads the entire locale set provided by libicu, which might be quite large.

```typescript
import { PGlite } from '@electric-sql/pglite'
import { icuDataDir } from '@electric-sql/pglite-icu-full'

// Create a PGlite instance with the icu resources
const pg = await PGlite.create({
  icuDataDir: await icuDataDir(),
})

// just an example, query the available collations
const collations = await pg.exec('select * from pg_collation')

```

# Documentation

https://www.postgresql.org/docs/current/locale.html