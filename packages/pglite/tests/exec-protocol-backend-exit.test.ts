import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const RESULT_PREFIX = 'PGLITE_BACKEND_EXIT_RESULT:'
const READY_PREFIX = 'PGLITE_BACKEND_EXIT_READY'
const CHILD_STARTUP_TIMEOUT_MS = 15_000
const CHILD_BACKEND_OPERATION_TIMEOUT_MS = 2000
const fixturePath = fileURLToPath(
  new URL('./fixtures/exec-protocol-backend-exit.js', import.meta.url),
)

type ReproMode =
  | 'no-transaction'
  | 'transaction'
  | 'runtime-error'
  | 'runtime-error-after-message'
  | 'runtime-error-with-cleanup-error'

interface ReproResult {
  outcome: 'resolved' | 'rejected' | 'fixture-error'
  error?: {
    name?: string
    message: string
    status?: number
  }
  processExitCode?: number
  childPid: number
  childExitCode: number
}

function runBackendExitRepro(
  mode: ReproMode,
  startupDelayMs = 0,
): Promise<ReproResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [fixturePath, mode, startupDelayMs.toString()],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    const childPid = child.pid
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let timeoutPhase = 'startup'
    let timeoutMs = CHILD_STARTUP_TIMEOUT_MS

    const killOnTimeout = () => {
      timedOut = true
      child.kill('SIGKILL')
    }
    let timeout = setTimeout(killOnTimeout, timeoutMs)

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk
      if (timeoutPhase === 'startup' && stdout.includes(`${READY_PREFIX}\n`)) {
        clearTimeout(timeout)
        timeoutPhase = 'backend operation'
        timeoutMs = CHILD_BACKEND_OPERATION_TIMEOUT_MS
        timeout = setTimeout(killOnTimeout, timeoutMs)
      }
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })

    child.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })

    child.once('exit', (code, signal) => {
      clearTimeout(timeout)

      if (timedOut) {
        reject(
          new Error(
            `Child ${childPid} timed out during ${timeoutPhase} after ${timeoutMs}ms and exited with signal ${signal}`,
          ),
        )
        return
      }

      if (code !== 0) {
        reject(
          new Error(
            `Child ${childPid} exited with code ${code}: ${stderr || stdout}`,
          ),
        )
        return
      }

      const resultLine = stdout
        .split('\n')
        .find((line) => line.startsWith(RESULT_PREFIX))

      if (!resultLine || childPid === undefined) {
        reject(new Error(`Child did not report a result: ${stderr || stdout}`))
        return
      }

      resolve({
        ...JSON.parse(resultLine.slice(RESULT_PREFIX.length)),
        childPid,
        childExitCode: code,
      })
    })
  })
}

function expectChildExited(result: ReproResult) {
  expect(result.childExitCode).toBe(0)
  expect(() => process.kill(result.childPid, 0)).toThrow()
}

describe('execProtocolRawSync backend exits', () => {
  it.each(['no-transaction', 'transaction'] as const)(
    'rethrows ExitStatus with %s',
    async (mode) => {
      const result = await runBackendExitRepro(mode)

      expect(result).toMatchObject({
        outcome: 'rejected',
        error: {
          name: 'ExitStatus',
          status: 1,
        },
        processExitCode: 42,
      })
      expectChildExited(result)
    },
  )

  it('rethrows RuntimeError', async () => {
    const result = await runBackendExitRepro('runtime-error')

    expect(result).toMatchObject({
      outcome: 'rejected',
      error: {
        name: 'RuntimeError',
        message: 'synthetic runtime failure',
      },
      processExitCode: 42,
    })
    expectChildExited(result)
  })

  it('preserves recoverable RuntimeError after processing the message', async () => {
    const result = await runBackendExitRepro('runtime-error-after-message')

    expect(result).toMatchObject({
      outcome: 'resolved',
      processExitCode: 42,
    })
    expectChildExited(result)
  })

  it('preserves RuntimeError when cleanup also throws', async () => {
    const result = await runBackendExitRepro('runtime-error-with-cleanup-error')

    expect(result).toMatchObject({
      outcome: 'rejected',
      error: {
        name: 'RuntimeError',
        message: 'synthetic runtime failure',
      },
      processExitCode: 42,
    })
    expectChildExited(result)
  })

  it('allows slow child initialization before timing the backend operation', async () => {
    const result = await runBackendExitRepro('runtime-error', 2500)

    expect(result).toMatchObject({
      outcome: 'rejected',
      error: {
        name: 'RuntimeError',
        message: 'synthetic runtime failure',
      },
      processExitCode: 42,
    })
    expectChildExited(result)
  })
})
