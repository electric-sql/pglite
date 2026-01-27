import InitdbModFactory, { InitdbMod } from './initdbModFactory'
import parse from './argsParser'
import assert from 'assert'
// import fs from 'node:fs'

export const PGDATA = '/pglite/data'

const initdbExePath = '/pglite/bin/initdb'
const pgstdoutPath = '/pglite/pgstdout'
const pgstdinPath = '/pglite/pgstdin'

/**
 * Interface defining what initdb needs from a PGlite instance.
 * This avoids a circular dependency between pglite and pglite-initdb.
 */
export interface PGliteForInitdb {
  Module: {
    HEAPU8: Uint8Array
    stringToUTF8OnStack(str: string): number
    _pgl_freopen(path: number, mode: number, fd: number): void
    FS: any
  }
  callMain(args: string[]): number
}

interface ExecResult {
  exitCode: number
  stderr: string
  stdout: string
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
}: {
  pg: PGliteForInitdb
  debug?: number
  args: string[]
}): Promise<ExecResult> {

  let system_fn, popen_fn, pclose_fn

  let needToCallPGmain = false
  let postgresArgs: string[] = []

  let pgMainResult = 0

  // let pglite_stdin_fd = -1
  let initdb_stdin_fd = -1
  // let pglite_stdout_fd = -1
  let initdb_stdout_fd = -1
  // let i_pgstdin = 0
  let stderrOutput: string = ''
  let stdoutOutput: string = ''

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
    thisProgram: initdbExePath,
    print: (text) => {
      stdoutOutput += text
      log(debug, 'initdbout', text)
    },
    printErr: (text) => {
      stderrOutput += text
      log(debug, 'initdberr', text)
    },
    preRun: [
      // (mod: InitdbMod) => {
      //   mod.FS.init(initdb_stdin, initdb_stdout, null)
      // },
      (mod: InitdbMod) => {
        mod.onRuntimeInitialized = () => {
          // default $HOME in emscripten is /home/web_user
          system_fn = mod.addFunction((cmd_ptr: number) => {
            postgresArgs = getArgs(mod.UTF8ToString(cmd_ptr))
            return callPgMain(postgresArgs)
          }, 'pi')

          mod._pgl_set_system_fn(system_fn)

          popen_fn = mod.addFunction((cmd_ptr: number, mode: number) => {
            const smode = mod.UTF8ToString(mode)
            postgresArgs = getArgs(mod.UTF8ToString(cmd_ptr))

            if (smode === 'r') {
              pgMainResult = callPgMain(postgresArgs)
              return initdb_stdin_fd;
            } else {
              if (smode === 'w') {
                needToCallPGmain = true
                return initdb_stdout_fd;
              } else {
                throw `Unexpected popen mode value ${smode}`
              }
            }

          }, 'ppi')

          mod._pgl_set_popen_fn(popen_fn)

          pclose_fn = mod.addFunction((stream: number) => {
            if (stream === initdb_stdin_fd || stream === initdb_stdout_fd) {
              // if the last popen had mode w, execute now postgres' main()
              if (needToCallPGmain) {
                needToCallPGmain = false
                pgMainResult = callPgMain(postgresArgs)
              }
              // const closeResult = mod._fclose(stream)
              // console.log(closeResult)
              return pgMainResult
            } else {
              return mod._pclose(stream)
            }

          }, 'pi')

          mod._pgl_set_pclose_fn(pclose_fn)

          {
            const pglite_stdin_path = pg.Module.stringToUTF8OnStack(pgstdinPath)
            const rmode = pg.Module.stringToUTF8OnStack('r')
             pg.Module._pgl_freopen(pglite_stdin_path, rmode, 0)
            const pglite_stdout_path = pg.Module.stringToUTF8OnStack(pgstdoutPath)
            const wmode = pg.Module.stringToUTF8OnStack('w')
             pg.Module._pgl_freopen(pglite_stdout_path, wmode, 1)
          }
  
          {
            const initdb_path = mod.stringToUTF8OnStack(pgstdoutPath)
            const rmode = mod.stringToUTF8OnStack('r')
            initdb_stdin_fd = mod._fopen(initdb_path, rmode)
  
            const path = mod.stringToUTF8OnStack(pgstdinPath)
            const wmode = mod.stringToUTF8OnStack('w')
            initdb_stdout_fd = mod._fopen(path, wmode)
          }

          // pg.Module.FS.chdir(PGDATA)
        }
      },
      (mod: InitdbMod) => {
        mod.ENV.PGDATA = PGDATA
      },
      (mod: InitdbMod) => {
        mod.FS.mkdir('/pglite');
        mod.FS.mount(mod.PROXYFS, {
          root: '/pglite',
          fs: pg.Module.FS
        }, '/pglite')
      },
    ],
  }

  const initDbMod = await InitdbModFactory(emscriptenOpts)

  log(debug, 'calling initdb.main with', args)
  const result = initDbMod.callMain(args)

  // again reset the heap before returning
  pg.Module.HEAPU8.set(origHEAPU8)

  return {
    exitCode: result,
    stderr: stderrOutput,
    stdout: stdoutOutput,
  }
}

interface InitdbOptions {
  pg: PGliteForInitdb
  debug?: number
  args?: string[]
}

function getArgs(cmd: string) {
  let a: string[] = []
  let parsed = parse(cmd)
  // console.log("parsed args", parsed)
  for (let i = 0; i < parsed.length; i++) {
    if (parsed[i].op) break;
    a.push(parsed[i])
  }
  return a
}

/**
 * Execute initdb
 */
export async function initdb({
  pg,
  debug,
  args
}: InitdbOptions): Promise<ExecResult> {

  const execResult = await execInitdb({
    pg,
    debug,
    args: ["--allow-group-access", "--encoding", "UTF8", "--locale=C.UTF-8", "--locale-provider=libc",
    ...(args ?? [])],
  })

  if (execResult.exitCode !== 0) {
    throw new Error(
      `initdb failed with exit code ${execResult.exitCode}. \nError message: ${execResult.stderr}\n Stdout: ${execResult.stdout}`,
    )
  }

  return execResult
}
