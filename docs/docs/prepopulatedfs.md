# Pre-populated FS

A pre-populated FS that you can use instead of letting initdb run (which is the default). This can lead to faster startup times because initdb doesn't need to run.

This package contains an archive as a static asset that you can access through the `dataDir()` function.

:::info
The prepopulated FS is created during build on our CI and therefore guaranteed to work only for the corresponding version of PGlite from which it was created. If you encounter issues, make sure this package is up to date with your PGlite version.
:::

## Installation

```bash
npm install @electric-sql/pglite-prepopulatedfs
# or
yarn add @electric-sql/pglite-prepopulatedfs
# or
pnpm add @electric-sql/pglite-prepopulatedfs
```

## Usage

```typescript
import { PGlite } from '@electric-sql/pglite'
import { dataDir } from '@electric-sql/pglite-prepopulatedfs'

// Create a PGlite instance with the prepopulated FS
const pg = await PGlite.create({
  loadDataDir: await dataDir(),
})
```

As an example, this is useful when you have multiple test, each with its own PGlite instance. Consider the following usage with vitest:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { dataDir } from '@electric-sql/pglite-prepopulatedfs'

describe('query and exec with different data sizes', () => {
  let pg: PGlite

  beforeEach(async () => {
    pg = await PGlite.create({
      loadDataDir: await dataDir(),
    })

    await pg.exec(`
        // setup default data
      `)
  })

  describe('test no. 1', () => {
    ...
  })

  describe('test no. 2', () => {
    ...
  })

  // many more tests here
})
```

Although more bandwidth is needed to download the `@electric-sql/pglite-prepopulatedfs` package, the tests will run faster as PGlite doesn't need to run `initdb` for each one of them.

The same applies if your application needs to instantiate PGlite over and over again with a clean slate. You will initialy use more bandwidth but will save on speed in the long-run.

## Benchmarking

A simple benchmarking is done as part of our automated testing in `packages/pglite-prepopulatedfs/tests/prepopulatedfs.test.ts`.

Here is a sample output on an Apple M1:

```
initdb duration: prepopulated avg (trimmed) 263.38 ms vs. classic initdb 886.29 ms.
Speedup: 3.37x
```
