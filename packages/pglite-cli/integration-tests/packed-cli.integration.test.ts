import { test } from 'vitest'
import { integrationConfig, runScenario } from './scenario-runner.js'

const config = integrationConfig()

test('runs the packed distribution through native PostgreSQL clients', async () => {
  await runScenario(new URL('./scenarios/packed-cli.mjs', import.meta.url), [
    config.repoRoot,
    config.nativeRoot,
    config.outputRoot,
  ])
})
