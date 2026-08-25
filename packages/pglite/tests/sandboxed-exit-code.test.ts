import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

interface FixtureResult {
  ok: boolean
  row?: number
  exitCode?: number
  processRestored: boolean
  setterCalls: number
  error?: {
    name: string
    message: string
    stack?: string
  }
}

const fixturePath = fileURLToPath(
  new URL('./fixtures/sandboxed-exit-code.js', import.meta.url),
)

function runFixture(mode: 'sandboxed' | 'node'): Promise<FixtureResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fixturePath, mode], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let timedOut = false

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })

    const timeout = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, 20_000)

    child.on('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.on('close', (code, signal) => {
      clearTimeout(timeout)
      if (timedOut) {
        reject(new Error(`Fixture timed out; stderr: ${stderr}`))
        return
      }
      if (code !== 0) {
        reject(
          new Error(
            `Fixture exited with code ${code} and signal ${signal}; stderr: ${stderr}`,
          ),
        )
        return
      }

      try {
        resolve(JSON.parse(stdout))
      } catch (error) {
        reject(
          new Error(
            `Fixture returned invalid JSON: ${stdout}; stderr: ${stderr}`,
            {
              cause: error,
            },
          ),
        )
      }
    })
  })
}

describe('process.exitCode handling during initdb', () => {
  it('boots when a Node-shaped process has a throwing exitCode setter', async () => {
    const result = await runFixture('sandboxed')

    expect(result.ok, JSON.stringify(result, null, 2)).toBe(true)
    expect(result).toMatchObject({
      row: 1,
      processRestored: true,
    })
  })

  it('preserves the normal Node exitCode behavior', async () => {
    const result = await runFixture('node')

    expect(result).toMatchObject({
      ok: true,
      row: 1,
      exitCode: 0,
      processRestored: true,
      setterCalls: 0,
    })
  })
})
