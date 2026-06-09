import InitdbModFactory, { InitdbMod } from './initdbModFactory'
import parse from './argsParser'
import { pglUtils } from '@electric-sql/pglite-utils'

function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) {
    throw new Error(message ?? 'Assertion failed')
  }
}

export const PG_ROOT = '/pglite'
export const PGDATA = PG_ROOT + '/data'
export const ICU_DATA_PATH = PG_ROOT + '/icu'
export const INITDB_EXE_PATH = PG_ROOT + '/bin/initdb'
export const POSTGRES_EXE_PATH = PG_ROOT + '/bin/postgres'

const pgstdoutPath = PG_ROOT + '/pgstdout'
const pgstdinPath = PG_ROOT + '/pgstdin'

/**
 * Interface defining what initdb needs from a PGlite instance.
 * This avoids a circular dependency between pglite and pglite-initdb.
 */
export interface PGliteForInitdb {
  Module: {
    HEAPU8: Uint8Array
    stringToUTF8OnStack(str: string): number
    _pgl_freopen(path: number, mode: number, fd: number): number
    FS: any
    _fclose: (stream: number) => number
  }
  callMain(args: string[]): number
}

interface ExecResult {
  exitCode: number
  stderr: string
  stdout: string
  dataFolder: string
}

function log(debug?: number, ...args: any[]) {
  if (debug && debug > 0) {
    console.log('initdb: ', ...args)
  }
}

async function execInitdb({
  pg,
  debug,
  args,
  wasmModule,
}: {
  pg: PGliteForInitdb
  debug?: number
  args: string[]
  wasmModule?: WebAssembly.Module
}): Promise<ExecResult> {
  let system_fn, popen_fn, pclose_fn

  let needToCallPGmain = false
  let postgresArgs: string[] = []

  let pgMainResult = 0

  let initdb_stdin_fd = -1
  let initdb_stdout_fd = -1
  let stderrOutput: string = ''
  let stdoutOutput: string = ''

  let stdinF: number | undefined
  let stdoutF: number | undefined

  const callPgMain = (args: string[]) => {
    const firstArg = args.shift()
    log(debug, 'initdb: firstArg', firstArg)
    assert(firstArg === '/pglite/bin/postgres', `trying to execute ${firstArg}`)

    pg.Module.HEAPU8.set(origHEAPU8)

    log(debug, 'executing pg main with', args)
    const result = pg.callMain(args)

    log(debug, result)

    postgresArgs = []

    return result
  }

  const origHEAPU8 = pg.Module.HEAPU8.slice()

  const emscriptenOpts: Partial<InitdbMod> = {
    arguments: args,
    noExitRuntime: false,
    thisProgram: INITDB_EXE_PATH,
    // Provide a stdin that returns EOF to avoid browser prompt
    stdin: () => null,
    print: (text) => {
      stdoutOutput += text
      log(debug, 'initdbout', text)
    },
    printErr: (text) => {
      stderrOutput += text
      log(debug, 'initdberr', text)
    },
    instantiateWasm: (imports, successCallback) => {
      const moduleUrl = new URL('../release/initdb.wasm', import.meta.url)
      pglUtils
        .instantiateWasm(imports, moduleUrl, wasmModule)
        .then(({ instance, module }) => {
          // @ts-ignore wrong type in Emscripten typings
          successCallback(instance, module)
        })
      return {}
    },
    preRun: [
      (mod: InitdbMod) => {
        mod.ENV.PGDATA = PGDATA
        mod.ENV.HOME = '/home/postgres'
        mod.ENV.USER = 'postgres'
        mod.ENV.LOGNAME = 'postgres'
        mod.ENV.ICU_DATA = ICU_DATA_PATH
      },
      (initdbMod: InitdbMod) => {
        initdbMod.onRuntimeInitialized = () => {
          system_fn = initdbMod.addFunction((cmd_ptr: number) => {
            postgresArgs = getArgs(initdbMod.UTF8ToString(cmd_ptr))
            return callPgMain(postgresArgs)
          }, 'pi')

          initdbMod._pgl_set_system_fn(system_fn)

          popen_fn = initdbMod.addFunction((cmd_ptr: number, mode: number) => {
            const smode = initdbMod.UTF8ToString(mode)
            postgresArgs = getArgs(initdbMod.UTF8ToString(cmd_ptr))

            if (smode === 'r') {
              pgMainResult = callPgMain(postgresArgs)
              return initdb_stdin_fd
            } else {
              if (smode === 'w') {
                needToCallPGmain = true
                return initdb_stdout_fd
              } else {
                throw `Unexpected popen mode value ${smode}`
              }
            }
          }, 'ppi')

          initdbMod._pgl_set_popen_fn(popen_fn)

          pclose_fn = initdbMod.addFunction((stream: number) => {
            if (stream === initdb_stdin_fd || stream === initdb_stdout_fd) {
              // if the last popen had mode w, execute now postgres' main()
              if (needToCallPGmain) {
                needToCallPGmain = false
                pgMainResult = callPgMain(postgresArgs)
              }
              return pgMainResult
            } else {
              return initdbMod._pclose(stream)
            }
          }, 'pi')

          initdbMod._pgl_set_pclose_fn(pclose_fn)

          {
            const pglite_stdin_path = pg.Module.stringToUTF8OnStack(pgstdinPath)
            const rmode = pg.Module.stringToUTF8OnStack('r')
            stdinF = pg.Module._pgl_freopen(pglite_stdin_path, rmode, 0)
            const pglite_stdout_path =
              pg.Module.stringToUTF8OnStack(pgstdoutPath)
            const wmode = pg.Module.stringToUTF8OnStack('w')
            stdoutF = pg.Module._pgl_freopen(pglite_stdout_path, wmode, 1)
          }

          {
            const initdb_path = initdbMod.stringToUTF8OnStack(pgstdoutPath)
            const rmode = initdbMod.stringToUTF8OnStack('r')
            initdb_stdin_fd = initdbMod._fopen(initdb_path, rmode)

            const path = initdbMod.stringToUTF8OnStack(pgstdinPath)
            const wmode = initdbMod.stringToUTF8OnStack('w')
            initdb_stdout_fd = initdbMod._fopen(path, wmode)
          }
        }
      },
      (mod: InitdbMod) => {
        mod.FS.mkdir(PG_ROOT)
        mod.FS.mount(
          mod.PROXYFS,
          {
            root: PG_ROOT,
            fs: pg.Module.FS,
          },
          PG_ROOT,
        )
      },
    ],
  }

  const initDbMod = await InitdbModFactory(emscriptenOpts)

  log(debug, 'calling initdb.main with', args)
  const result = initDbMod.callMain(args)

  if (stdinF) {
    pg.Module._fclose(stdinF)
  }

  if (stdoutF) {
    pg.Module._fclose(stdoutF)
  }

  pg.Module.FS.unlink(pgstdinPath)
  pg.Module.FS.unlink(pgstdoutPath)

  return {
    exitCode: result,
    stderr: stderrOutput,
    stdout: stdoutOutput,
    dataFolder: PGDATA,
  }
}

interface InitdbOptions {
  pg: PGliteForInitdb
  debug?: number
  args?: string[]
  wasmModule?: WebAssembly.Module
}

function getArgs(cmd: string) {
  const a: string[] = []
  const parsed = parse(cmd)
  for (let i = 0; i < parsed.length; i++) {
    const token = parsed[i]
    if (typeof token === 'object' && 'op' in token) break
    if (typeof token === 'string') a.push(token)
  }
  return a
}

/**
 * Execute initdb
 */
export async function initdb({
  pg,
  debug,
  args,
  wasmModule,
}: InitdbOptions): Promise<ExecResult> {
  const execResult = await execInitdb({
    pg,
    debug,
    args: [
      '--allow-group-access',
      '--encoding',
      'UTF8',
      '--locale=C.UTF-8',
      '--locale-provider=libc',
      '--auth=trust',
      ...(args ?? []),
    ],
    wasmModule,
  })

  return execResult
}
