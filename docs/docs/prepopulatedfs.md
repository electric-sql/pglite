# Pre-populated FS

A pre-populated FS that you can use instead of using the default initdb run. This can lead to faster startup times because initdb doesn't need to run.

This package contains an archive as a static asset that you can access through the `dataDir()` function.

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
const _db = await PGlite.create({
  loadDataDir: await dataDir(),
})
```