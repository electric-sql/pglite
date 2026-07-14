import { join } from 'node:path'
import { test } from 'vitest'
import { integrationConfig, runScenario } from './scenario-runner.js'

const config = integrationConfig()

test('reclaims 10,000 backend sessions and recovers from a crash', async () => {
  await runScenario(
    new URL('./scenarios/postmaster-stress.mjs', import.meta.url),
    [
      config.repoRoot,
      config.wasm,
      config.glue,
      config.data,
      config.pgbench,
      config.outputRoot,
      join(config.outputRoot, 'stress.json'),
    ],
  )
})
