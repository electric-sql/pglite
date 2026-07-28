import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

interface CliIntegrationConfig {
  readonly repoRoot: string
  readonly nativeRoot: string
  readonly outputRoot: string
}

export function integrationConfig(): CliIntegrationConfig {
  const value = process.env.PGLITE_CLI_INTEGRATION_CONFIG
  if (!value) throw new Error('PGLITE_CLI_INTEGRATION_CONFIG is required')
  return JSON.parse(value) as CliIntegrationConfig
}

export async function runScenario(
  script: URL,
  args: readonly string[],
): Promise<void> {
  const scriptPath = fileURLToPath(script)
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      stdio: 'inherit',
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(`${scriptPath} exited with ${code ?? signal}`))
    })
  })
}
