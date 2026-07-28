import type { PostgresToolRunner } from './tool-runner.js'
import type { NativeToolCommand } from './native-tool-identity.js'
import { pgDumpRunner } from './pg_dump_native.js'
import { pgIsReadyRunner } from './pg_isready.js'
import { psqlRunner } from './psql.js'
import { pgRestoreRunner } from './pg_restore.js'
import {
  clusterDbRunner,
  createDbRunner,
  createUserRunner,
  dropDbRunner,
  dropUserRunner,
  reindexDbRunner,
  vacuumDbRunner,
} from './admin.js'

export type { NativeToolCommand } from './native-tool-identity.js'

export const nativeToolRunners: Readonly<
  Record<NativeToolCommand, PostgresToolRunner>
> = Object.freeze({
  pg_dump: pgDumpRunner,
  pg_isready: pgIsReadyRunner,
  psql: psqlRunner,
  pg_restore: pgRestoreRunner,
  createdb: createDbRunner,
  createuser: createUserRunner,
  dropdb: dropDbRunner,
  dropuser: dropUserRunner,
  clusterdb: clusterDbRunner,
  vacuumdb: vacuumDbRunner,
  reindexdb: reindexDbRunner,
})
