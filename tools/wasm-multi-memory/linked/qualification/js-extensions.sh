#!/usr/bin/env bash
# Use the JS workspace populated by sdk/release.sh with its linked core package.
set -euo pipefail
export PATH="/opt/node22/bin:$PATH"
cd /build/workspace/packages
(cd pglite && pnpm exec vitest run tests/live.test.ts)
(cd pglite-sync && pnpm exec vitest run test/sync.test.ts)
(cd pglite-icu-full && pnpm build && pnpm exec vitest run tests/icuDataDir.test.ts)
cd pglite-icu-full
cat > qualification-icu.mjs <<'JS'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { PGlitePostmaster } from '@electric-sql/pglite/postmaster'
import { icuDataDir } from './dist/index.js'
const path = await mkdtemp(join(tmpdir(),'pglite-icu-'))
let cluster
try {
  cluster = await PGlitePostmaster.create({dataDir:pathToFileURL(path).href,icuDataDir:await icuDataDir()})
  let session
  for (let attempt=0; !session; attempt++) {
    try { session = await cluster.createSession() } catch (error) {
      if (error.code !== '57P03' || attempt >= 99) throw error
      await delay(25)
    }
  }
  try {
    const {rows} = await session.query("SELECT count(*)::int AS n FROM pg_collation WHERE collprovider='i'")
    assert.ok(rows[0].n > 850)
  } finally { await session.close() }
} finally {
  await cluster?.close()
  await rm(path,{recursive:true,force:true})
}
console.log('Postmaster full ICU collations: PASS')
JS
node22 qualification-icu.mjs
