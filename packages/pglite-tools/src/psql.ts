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

export const psqlRunner: PostgresToolRunner = createNativeToolRunner(
  'psql',
  new URL('./native/psql.js', import.meta.url),
  nativeToolRuntimeIdentity.artifacts.psql,
)

export function runPsql(invocation: PostgresToolInvocation): Promise<number> {
  return psqlRunner.run(invocation)
}
