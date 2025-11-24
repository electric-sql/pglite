import { PGlite } from '@electric-sql/pglite'
import InitdbModFactory, { InitdbMod } from './initdbModFactory'

export const WASM_PREFIX = '/pglite'
export const PGDATA = WASM_PREFIX + '/data'

const initdbExePath = '/pglite/bin/initdb'

interface ExecResult {
  exitCode: number
  stderr: string
  stdout: string
}

/**
 * Inner function to execute initdb
 */
async function execInitdb({
  pg,
  args,
}: {
  pg: PGlite
  args: string[]
}): Promise<ExecResult> {
  // let pgdump_write, pgdump_read, 
  let system, popen, fgets
  let stderrOutput: string = ''
  let stdoutOutput: string = ''
  let pgstderr = ''
  let pgstdout = ''
  const emscriptenOpts: Partial<InitdbMod> = {
    arguments: args,
    noExitRuntime: false,
    thisProgram: initdbExePath,
    print: (text) => {
      stdoutOutput += text
    },
    printErr: (text) => {
      stderrOutput += text
    },
    preRun: [
      (mod: InitdbMod) => {
        mod.onRuntimeInitialized = () => {
          // default $HOME in emscripten is /home/web_user
          system = mod.addFunction((cmd_ptr: number) => {
            // todo: check it is indeed exec'ing postgres
            const postgresArgs = getArgs(mod.HEAPU8, cmd_ptr)
            postgresArgs.shift()
            return pg.callMain(postgresArgs)
          }, 'pi')

          mod._pgl_set_system_fn(system)

          popen = mod.addFunction((cmd_ptr: number, mode: number) => {
            console.log(mode)
            // todo: check it is indeed exec'ing postgres
            let postgresArgs = getArgs(mod.HEAPU8, cmd_ptr)
            postgresArgs.shift()
            const onPostgresPrint = (text: string) => pgstdout += text
            pg.addPrintCb(onPostgresPrint)
            const onPostgresPrintErr = (text: string) => pgstderr += text
            pg.addPrintErrCb(onPostgresPrintErr)
            const result = pg.callMain(postgresArgs)
            console.log(result)
            pg.removePrintCb(onPostgresPrint)
            pg.removePrintErrCb(onPostgresPrintErr)
            return 99; // this is supposed to be a file descriptor
          }, 'ppi')

          mod._pgl_set_popen_fn(popen)

          fgets = mod.addFunction((str: number, size: number, stream: number) => {
            console.log(str, size, stream)
            if (stream == 99) {
              if (pgstdout.length) {
                let i = 0
                let arr = new Array<number>()
                while (i < size - 1 && i < pgstdout.length) {
                  arr.push(pgstdout.charCodeAt(i))
                  if (pgstdout[i++] === '\n') {
                    break;
                  }
                }
                if (arr.length === pgstdout.length && pgstdout[pgstdout.length] !== '\n') {
                  arr.push('\n'.charCodeAt(0))
                }
                pgstdout = pgstdout.substring(i)
                if (arr.length) {
                  arr.push('\0'.charCodeAt(0))
                  mod.HEAP8.set(arr, str)
                  return str
                }
                return null;
              } else {
                return null;
              }
            } else {
              mod._pgl_set_errno(1);
              return null;
              // throw 'PGlite: unknown stream'
            }
          }, 'pipp')

          mod._pgl_set_fgets_fn(fgets)
        }
      },
      (mod: InitdbMod) => {
        mod.ENV.PGDATA = PGDATA
      },
      (mod: InitdbMod) => {
        mod.FS.mkdir("/pglite");
        mod.FS.mount(mod.PROXYFS, {
          root: '/pglite',
          fs: pg.__FS!
        }, '/pglite')
      },      
    ],
  }

  const initDbMod = await InitdbModFactory(emscriptenOpts)

  const result = initDbMod.callMain(args)

  return {
    exitCode: result,
    stderr: stderrOutput,
    stdout: stdoutOutput,
  }
}

interface InitdbOptions {
  pg: PGlite
  args?: string[]
}

function getArgs(heapu8: Uint8Array, cmd_ptr: number) {
  let cmd = ''
  let c = String.fromCharCode(heapu8[cmd_ptr++])
  while (c != '\0') {
    cmd += c
    c = String.fromCharCode(heapu8[cmd_ptr++])
  }
  const postgresArgs = cmd.split(' ')
  return postgresArgs
}

/**
 * Execute initdb
 */
export async function initdb({
  pg,
  args
}: InitdbOptions) {

  const execResult = await execInitdb({
    pg,
    args: [...(args ?? [])],
  })

  if (execResult.exitCode !== 0) {
    throw new Error(
      `initdb failed with exit code ${execResult.exitCode}. \nError message: ${execResult.stderr}`,
    )
  }

  return execResult.exitCode
}
