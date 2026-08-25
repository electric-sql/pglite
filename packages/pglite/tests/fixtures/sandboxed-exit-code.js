const realProcess = globalThis.process
const originalExitCode = realProcess.exitCode
const mode = realProcess.argv[2]

let setterCalls = 0
let expectedProcess = realProcess
let pg
let result

if (mode === 'sandboxed') {
  const sandboxedProcess = Object.create(realProcess)
  Object.defineProperty(sandboxedProcess, 'exitCode', {
    get() {
      return 0
    },
    set() {
      setterCalls++
      throw new Error('sandboxed process.exitCode setter called')
    },
    configurable: false,
    enumerable: true,
  })
  globalThis.process = sandboxedProcess
  expectedProcess = sandboxedProcess
} else if (mode === 'node') {
  realProcess.exitCode = 23
} else {
  throw new Error(`Unknown fixture mode: ${mode}`)
}

try {
  const { PGlite } = await import('../../dist/index.js')
  pg = await PGlite.create()
  const queryResult = await pg.query('SELECT 1 AS one')

  result = {
    ok: true,
    row: queryResult.rows[0]?.one,
    exitCode: globalThis.process.exitCode,
    processRestored: globalThis.process === expectedProcess,
    setterCalls,
  }
} catch (error) {
  result = {
    ok: false,
    processRestored: globalThis.process === expectedProcess,
    setterCalls,
    error: {
      name: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    },
  }
} finally {
  globalThis.process = realProcess
  if (pg) {
    await pg.close()
  }
  realProcess.exitCode = originalExitCode
}

realProcess.stdout.write(JSON.stringify(result))
realProcess.exit(0)
