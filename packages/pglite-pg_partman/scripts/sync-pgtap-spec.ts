/**
 * Refresh the vendored pgTAP spec files in tests/pgtap/ from upstream.
 *
 * The files must stay byte-identical to the pg_partman release the
 * postgres-pglite submodule builds the WASM bundle from. To bump versions:
 * update UPSTREAM_TAG, run `pnpm sync-pgtap-spec`, and update the version
 * assertion in tests/pg_partman.test.ts (which fails loudly if the bundle
 * and this spec ever disagree).
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const UPSTREAM_TAG = 'v5.5.0'

const SPEC_FILES = [
  'test-id-1-bigint-list.sql',
  'test-id-1-int-list.sql',
  'test-id-10.sql',
  'test-time-daily.sql',
  'test-time-infinite-no-data.sql',
  'test-time-maintenance-order.sql',
  'test-time-monthly-infinity.sql',
  'test-time-monthly.sql',
]

const tag = process.argv[2] ?? UPSTREAM_TAG
if (tag !== UPSTREAM_TAG) {
  console.warn(
    `Syncing ${tag} instead of the pinned ${UPSTREAM_TAG} — remember to update UPSTREAM_TAG`,
  )
}

const specDir = fileURLToPath(new URL('../tests/pgtap', import.meta.url))
mkdirSync(specDir, { recursive: true })

// the harness runs every .sql in tests/pgtap, so a file that upstream renamed
// away must not linger here as a stale spec
for (const file of readdirSync(specDir)) {
  if (file.endsWith('.sql') && !SPEC_FILES.includes(file)) {
    rmSync(join(specDir, file))
    console.log(`removed ${file} (no longer in SPEC_FILES)`)
  }
}

let failed = false
for (const file of SPEC_FILES) {
  const url = `https://raw.githubusercontent.com/pgpartman/pg_partman/${tag}/test/${file}`
  const response = await fetch(url)
  if (!response.ok) {
    console.error(`${response.status} ${response.statusText}: ${url}`)
    console.error(
      `  was the file renamed or removed upstream? Update SPEC_FILES to match ${tag}'s test/ directory`,
    )
    failed = true
    continue
  }
  writeFileSync(join(specDir, file), await response.text())
  console.log(`synced ${file} (${tag})`)
}
if (failed) {
  process.exit(1)
}
