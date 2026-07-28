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
export type {
  PostgresToolInvocation,
  PostgresToolRunner,
} from './tool-runner.js'

export const pgRestoreRunner: PostgresToolRunner = createNativeToolRunner(
  'pg_restore',
  new URL('./native/pg_restore.js', import.meta.url),
  nativeToolRuntimeIdentity.artifacts.pg_restore,
)

export function runPgRestore(
  invocation: PostgresToolInvocation,
): Promise<number> {
  return pgRestoreRunner.run(invocation)
}
