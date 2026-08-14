import { PGlite } from '../../dist/index.js'

const RESULT_PREFIX = 'PGLITE_BACKEND_EXIT_RESULT:'
const ORIGINAL_EXIT_CODE = 42

function serializeError(error) {
  return {
    name:
      typeof error === 'object' && error !== null
        ? error.constructor?.name
        : typeof error,
    message: error instanceof Error ? error.message : String(error),
    status:
      typeof error === 'object' && error !== null && 'status' in error
        ? error.status
        : undefined,
  }
}

function reportResultAndExit(result, exitCode = 0) {
  return new Promise(() => {
    process.stdout.write(`${RESULT_PREFIX}${JSON.stringify(result)}\n`, () =>
      process.exit(exitCode),
    )
  })
}

const mode = process.argv[2]
process.exitCode = ORIGINAL_EXIT_CODE

try {
  const db = await PGlite.create()

  if (mode.startsWith('runtime-error')) {
    db.Module._PostgresMainLoopOnce = () => {
      if (mode === 'runtime-error-with-cleanup-error') {
        process.exitCode = 1
      }
      throw new WebAssembly.RuntimeError('synthetic runtime failure')
    }
    if (mode === 'runtime-error-with-cleanup-error') {
      db.Module._PostgresSendReadyForQueryIfNecessary = () => {
        throw new Error('synthetic cleanup failure')
      }
    }
  } else {
    await db.exec('CREATE TABLE t(a int)')
    if (mode === 'transaction') {
      await db.exec('BEGIN')
    }
  }

  try {
    if (mode.startsWith('runtime-error')) {
      db.execProtocolRawSync(Uint8Array.of('Q'.charCodeAt(0)))
    } else {
      await db.exec('COPY t FROM STDIN')
    }

    await reportResultAndExit(
      {
        outcome: 'resolved',
        processExitCode: process.exitCode,
      },
      2,
    )
  } catch (error) {
    await reportResultAndExit({
      outcome: 'rejected',
      error: serializeError(error),
      processExitCode: process.exitCode,
    })
  }
} catch (error) {
  await reportResultAndExit(
    {
      outcome: 'fixture-error',
      error: serializeError(error),
      processExitCode: process.exitCode,
    },
    3,
  )
}
