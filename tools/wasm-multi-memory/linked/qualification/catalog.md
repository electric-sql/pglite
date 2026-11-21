# Shipped extension qualification

Each result covers Node 20.18.0 and 22.13.0 with a fresh database in each constructor. The verifier hashes the archive selected by the installed public wrapper and records each Wasm side module instantiated on the classic main thread or in a postmaster worker. Postmaster creates each SQL extension in one session and opens a fresh session for its feature test. LOAD hooks run in the session being measured.

Contrib imports use `@electric-sql/pglite/contrib/<entry>`. Standalone imports use `@electric-sql/pglite-<entry>`. The existing test column names the package test file, or the upstream PostgreSQL suite. The qualification cases exercise the feature listed here.

| Entry | Feature | Dependencies or startup configuration | Existing test | Classic | Postmaster |
| --- | --- | --- | --- | --- | --- |
| contrib `amcheck` | Check a system B-tree against its heap | — | amcheck.test.js | pass | pass |
| contrib `auto_explain` | Capture an execution plan notice | LOAD | auto_explain.test.js | pass | pass |
| contrib `bloom` | Bloom equality index scan | — | bloom.test.js | pass | pass |
| contrib `btree_gin` | GIN integer index scan | — | btree_gin.test.js | pass | pass |
| contrib `btree_gist` | GiST integer index scan | — | btree_gist.test.js | pass | pass |
| contrib `citext` | Case-insensitive equality | — | citext.test.js | pass | pass |
| contrib `cube` | Euclidean distance | — | cube.test.js | pass | pass |
| contrib `dict_int` | Truncate an integer lexeme | — | dict_int.test.js | pass | pass |
| contrib `dict_xsyn` | Expand a synonym using the shipped dictionary | — | dict_xsyn.test.ts | pass | pass |
| contrib `earthdistance` | Distance between coordinates | cube | earthdistance.test.js | pass | pass |
| contrib `file_fdw` | Read a packaged file as a foreign table | — | file_fdw.test.ts | pass | pass |
| contrib `fuzzystrmatch` | Levenshtein distance | — | fuzzystrmatch.test.js | pass | pass |
| contrib `hstore` | Look up a key | — | hstore.test.js | pass | pass |
| contrib `intarray` | Sort and deduplicate integers | — | intarray.test.js | pass | pass |
| contrib `isn` | Normalize an ISBN | — | isn.test.js | pass | pass |
| contrib `lo` | Unlink a large object using a delete trigger | — | lo.test.js | pass | pass |
| contrib `ltree` | Match a descendant path | — | ltree.test.js | pass | pass |
| contrib `pageinspect` | Read heap line pointers | — | pageinspect.test.js | pass | pass |
| contrib `passwordcheck` | Reject a short role password | LOAD | upstream contrib/passwordcheck | pass | pass |
| contrib `pg_buffercache` | Count occupied shared buffers | — | pg_buffercache.test.js | pass | pass |
| contrib `pg_freespacemap` | Read free space in a relation | — | pg_freespacemap.test.ts | pass | pass |
| contrib `pg_logicalinspect` | Decode a publication and inspect metadata and builder state from a logical snapshot | wal_level=logical for snapshot generation | upstream contrib/pg_logicalinspect | pass | pass |
| contrib `pg_overexplain` | Inspect plan node IDs with EXPLAIN (DEBUG) | LOAD | upstream contrib/pg_overexplain | pass | pass |
| contrib `pg_stat_statements` | Find a previously executed query and its call count | preload pg_stat_statements | pg_stat_statements.test.ts | pass | pass |
| contrib `pg_surgery` | Kill a tuple by TID and verify its removal | — | pg_surgery.test.js | pass | pass |
| contrib `pg_trgm` | Check the GIN plan and substring matches | — | pg_trgm.test.js | pass | pass |
| contrib `pg_visibility` | Read the visibility map | — | pg_visibility.test.js | pass | pass |
| contrib `pg_walinspect` | Read block records across an insertion | — | pg_walinspect.test.js | pass | pass |
| contrib `pgcrypto` | SHA-256 digest | — | pgcrypto.test.ts | pass | pass |
| contrib `seg` | Normalize an interval | — | seg.test.js | pass | pass |
| contrib `tablefunc` | Generate a requested number of samples | — | tablefunc.test.js | pass | pass |
| contrib `tcn` | Receive the inserted primary key in a notification | — | tcn.test.js | pass | pass |
| contrib `tsm_system_rows` | Sample exactly two rows | — | tsm_system_rows.test.js | pass | pass |
| contrib `tsm_system_time` | Time-budgeted sampling of a one-page table | — | tsm_system_time.test.js | pass | pass |
| contrib `unaccent` | Remove an accent | — | unaccent.test.js | pass | pass |
| contrib `uuid_ossp` | Generate a deterministic v5 UUID | — | uuid_ossp.test.ts | pass | pass |
| standalone `age` | Evaluate Cypher against a graph | LOAD age, ag_catalog on search_path | age.test.ts | pass | pass |
| standalone `pg_hashids` | Encode a known integer | — | pg_hashids.test.ts | pass | pass |
| standalone `pg_ivm` | Read an incrementally updated sum | — | pg_ivm.test.ts | pass | pass |
| standalone `pg_textsearch` | Rank documents using a BM25 index | preload pg_textsearch | pg_textsearch.test.ts | pass | pass |
| standalone `pg_uuidv7` | Generate a version-7 UUID | — | pg_uuidv7.test.ts | pass | pass |
| standalone `pgmq` | Send and receive JSON | — | pgmq.test.ts | pass | pass |
| standalone `pgtap` | Run a planned TAP assertion | plpgsql | pgtap.test.ts | pass | pass |
| standalone `postgis` | Transform coordinates and normalize a Tiger address | postgis, fuzzystrmatch, base library before raster/topology, PROJ data | postgis.test.ts | pass | pass |
| standalone `pgvector` | Compute L2 distance | — | pgvector.test.ts | pass | pass |

The separate Node 20/22 pgvector and PostGIS suite exercises HNSW, concurrent transaction visibility, cancellation, parallel workers, GiST, PROJ, GDAL raster and topology. pgTAP and pgmq contain SQL and ship zero Wasm modules. Each of the three LOAD-only contrib archives has a public wrapper in the linked package.
