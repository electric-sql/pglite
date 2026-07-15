import type {
  PostgresToolInvocation,
  PostgresToolRunner,
} from './tool-runner.js'
import {
  createNativeToolRunner,
  PGliteToolHostError,
} from './native-tool-runner.js'
import { nativeToolRuntimeIdentity } from './native-tool-identity.js'

export { PGliteToolHostError }

/** Native-style, socket/libpq pg_dump runner. This is distinct from pgDump(). */
export const pgDumpRunner: PostgresToolRunner = createNativeToolRunner(
  'pg_dump',
  new URL('./native/pg_dump.js', import.meta.url),
  nativeToolRuntimeIdentity.artifacts.pg_dump,
)

export function runPgDump(invocation: PostgresToolInvocation): Promise<number> {
  return pgDumpRunner.run(invocation)
}
