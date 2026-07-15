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

export const pgIsReadyRunner: PostgresToolRunner = createNativeToolRunner(
  'pg_isready',
  new URL('./native/pg_isready.js', import.meta.url),
  nativeToolRuntimeIdentity.artifacts.pg_isready,
)

export function pgIsReady(invocation: PostgresToolInvocation): Promise<number> {
  return pgIsReadyRunner.run(invocation)
}
