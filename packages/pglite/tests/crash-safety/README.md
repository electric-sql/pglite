# PGlite Crash Safety Test Suite

Tests that reproduce real corruption bugs in PGlite — specifically the issues fixed by the PID file lock and partial initdb detection in `nodefs.ts`. Every test here **fails without the fix** and passes with it.

Single-instance WAL recovery tests (kill-during-insert, kill-during-transaction, etc.) were intentionally excluded because PostgreSQL handles those correctly without any code changes. Those tests are preserved in the `archive/all-crash-safety-tests` branch.

## Running the Tests

```bash
# Run all crash safety tests
pnpm vitest run tests/crash-safety/ --reporter=verbose

# Run a single scenario
pnpm vitest run tests/crash-safety/overlapping-instances.test.js

# Keep data directories for debugging (not cleaned up after test)
RETAIN_DATA=1 pnpm vitest run tests/crash-safety/
```

> **Note:** Do not use `--no-file-parallelism` — PGlite's WASM module conflicts with vitest's single-worker mode.

## Architecture

```
tests/crash-safety/
├── harness.js                          # Shared test infrastructure
├── README.md                           # This file
├── CRASH-SAFETY.md                     # Detailed failure mode documentation
├── RESULTS.md                          # Test results log
├── hmr-double-instance.test.js         # HMR double-instance lock test
├── overlapping-instances.test.js       # Overlapping instance corruption test
├── wal-bloat-no-checkpoint.test.js     # WAL bloat burst mode corruption test
├── partial-init-backup.test.js         # Partial initdb backup behavior test
└── workers/
    ├── hmr-double-instance.js
    ├── overlapping-three-instances.js
    ├── overlapping-staggered.js
    ├── overlapping-ddl-writer.js
    ├── overlapping-rapid-cycling.js
    └── wal-bloat-no-checkpoint.js
```

### How It Works

Each test follows the same pattern:

1. **Worker script** — A standalone Node.js script that creates a PGlite instance on a data directory (passed via `PGLITE_DATA_DIR` env var), performs database operations, and sends IPC messages to the parent via `process.send()` to signal progress.

2. **Test file** — Uses vitest. Calls `crashTest()` from the harness to spawn the worker as a child process via `fork()`. The harness kills the child with `SIGKILL` either after a timer or when a specific IPC message is received.

3. **Verification** — After the kill, the test reopens PGlite on the same data directory and checks:

   - The database opens without error (no PANIC, no hang)
   - Basic queries succeed (`SELECT 1`)
   - All user tables are scannable
   - Data is consistent (committed rows present, uncommitted rows absent)

4. **Cleanup** — Each test uses a unique `/tmp/pglite-crash-*` directory and removes it in `afterAll`, unless `RETAIN_DATA=1` is set.

## Test Scenarios

### 1. Overlapping Instances

**File:** `overlapping-instances.test.js` (4 tests)

Multiple PGlite instances opening the same data directory concurrently. Without the PID file lock, this causes silent corruption (`Aborted()` on next open).

- **Triple instances** — three instances open simultaneously
- **Staggered** — second instance opens while first is mid-write
- **DDL writer** — overlapping DDL operations
- **Rapid cycling** — rapid open/kill/reopen cycles with overlapping lifetimes

### 2. HMR Double-Instance

**File:** `hmr-double-instance.test.js` (2 tests)

Simulates hot module replacement (HMR) in dev servers where a new PGlite instance is created before the old one is closed.

- **Lock blocking** — verifies instance B is blocked by the lock while instance A is alive
- **Rapid HMR cycles** — fast instance swaps that corrupt without the lock

### 3. WAL Bloat Burst Mode

**File:** `wal-bloat-no-checkpoint.test.js` (1 failing test)

15 extremely rapid kill cycles with no delay, accumulating WAL without checkpointing. Without partial initdb detection, interrupted initializations leave corrupt state that causes `Aborted()`.

### 4. Partial Init Backup

**File:** `partial-init-backup.test.js` (3 tests)

Directly tests the partial initdb detection and backup behavior in `nodefs.ts`:

- Partial dir (no `PG_VERSION`) → moved to `.corrupt-<timestamp>` backup
- Partial dir (`PG_VERSION` but incomplete `base/`) → moved to backup
- Fully initialized dir → NOT moved (no false positives)

## Harness API (`harness.js`)

### `crashTest(options)`

Spawns a child process and kills it.

| Option          | Type   | Default     | Description                                                    |
| --------------- | ------ | ----------- | -------------------------------------------------------------- |
| `dataDir`       | string | required    | Path to PGlite data directory                                  |
| `workerScript`  | string | required    | Path to the worker `.js` file                                  |
| `killAfterMs`   | number | `500`       | Delay before sending kill signal                               |
| `signal`        | string | `'SIGKILL'` | Signal to send (usually SIGKILL)                               |
| `killOnMessage` | string | `null`      | Kill when worker sends this IPC message instead of using timer |
| `env`           | object | `{}`        | Extra environment variables for the child                      |

Returns: `{ workerKilled, workerError, workerMessages, workerExitCode, workerSignal, stdout, stderr }`

### `tryOpen(dataDir, timeoutMs?)`

Attempts to open a PGlite instance on a potentially corrupted data directory. Includes a timeout (default 15s) to handle cases where a corrupted database hangs forever during initialization.

Returns: `{ success, db, error }`

### `verifyIntegrity(db)`

Runs integrity checks against an open PGlite instance: basic query, table scan, index scan.

Returns: `{ intact, issues }`

### `cleanupDataDir(dataDir)`

Removes a test data directory and its sibling `.lock` file.

### `testDataDir(scenarioName)`

Generates a unique `/tmp/pglite-crash-<name>-<timestamp>-<rand>` path.
