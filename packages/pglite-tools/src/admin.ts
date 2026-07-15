import type {
  PostgresToolInvocation,
  PostgresToolRunner,
} from './tool-runner.js'
import { createNativeToolRunner } from './native-tool-runner.js'
import {
  nativeToolRuntimeIdentity,
  type NativeToolCommand,
} from './native-tool-identity.js'

export type {
  PostgresToolInvocation,
  PostgresToolRunner,
} from './tool-runner.js'
export { PGliteToolHostError } from './native-tool-runner.js'

function runner(command: NativeToolCommand): PostgresToolRunner {
  return createNativeToolRunner(
    command,
    new URL(`./native/${command}.js`, import.meta.url),
    nativeToolRuntimeIdentity.artifacts[command],
  )
}

export const createDbRunner = runner('createdb')
export const createUserRunner = runner('createuser')
export const dropDbRunner = runner('dropdb')
export const dropUserRunner = runner('dropuser')
export const clusterDbRunner = runner('clusterdb')
export const vacuumDbRunner = runner('vacuumdb')
export const reindexDbRunner = runner('reindexdb')

export const runCreateDb = run(createDbRunner)
export const runCreateUser = run(createUserRunner)
export const runDropDb = run(dropDbRunner)
export const runDropUser = run(dropUserRunner)
export const runClusterDb = run(clusterDbRunner)
export const runVacuumDb = run(vacuumDbRunner)
export const runReindexDb = run(reindexDbRunner)

function run(
  tool: PostgresToolRunner,
): (invocation: PostgresToolInvocation) => Promise<number> {
  return (invocation) => tool.run(invocation)
}
