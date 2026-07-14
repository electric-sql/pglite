import { test } from 'vitest'
import { integrationConfig, runScenario } from './scenario-runner.js'

const config = integrationConfig()

test('serves native clients over TCP and Unix sockets', async () => {
  await runScenario(
    new URL('./scenarios/socket-frontend.mjs', import.meta.url),
    [config.repoRoot, config.wasm, config.glue, config.data, config.nativeRoot],
  )
})
