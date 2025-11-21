import { PGlite } from '@electric-sql/pglite'
import InitdbModFactory, { InitdbMod } from './initdbModFactory'

export const WASM_PREFIX = '/pglite'
export const PGDATA = WASM_PREFIX + '/' + 'db'

const initdbExePath = '/var/bin/postgresql/initdb'
const postgresExePath = '/var/bin/postgresql/postgres'

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
  let system, popen
  let stderrOutput: string = ''
  let stdoutOutput: string = ''
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
        mod.ENV.PGDATA = PGDATA
      },
      (mod: InitdbMod) => {
        mod.onRuntimeInitialized = () => {
          // let bufferedBytes: Uint8Array = new Uint8Array()

          // pgdump_write = mod.addFunction((ptr: any, length: number) => {
          //   let bytes
          //   try {
          //     bytes = mod.HEAPU8.subarray(ptr, ptr + length)
          //   } catch (e: any) {
          //     console.error('error', e)
          //     throw e
          //   }
          //   const currentResponse = pg.execProtocolRawSync(bytes)
          //   bufferedBytes = concat(bufferedBytes, currentResponse)
          //   return length
          // }, 'iii')

          // pgdump_read = mod.addFunction((ptr: any, max_length: number) => {
          //   let length = bufferedBytes.length
          //   if (length > max_length) {
          //     length = max_length
          //   }
          //   try {
          //     mod.HEAP8.set(bufferedBytes.subarray(0, length), ptr)
          //   } catch (e) {
          //     console.error(e)
          //   }
          //   bufferedBytes = bufferedBytes.subarray(length, bufferedBytes.length)
          //   return length
          // }, 'iii')

          // mod._pgl_set_rw_cbs(pgdump_read, pgdump_write)
          // default $HOME in emscripten is /home/web_user
          mod.FS.chmod('/home/web_user/.pgpass', 0o0600) // https://www.postgresql.org/docs/current/libpq-pgpass.html
          mod.FS.chmod(initdbExePath, 0o0555)
          mod.FS.chmod(postgresExePath, 0o0555)
          system = mod.addFunction((cmd: string[]) => {
            // todo: check it is indeed exec'ing postgres
            pg.Module.FS = mod.FS
            return pg.callMain(cmd)
          }, 'vi')

          mod._pgl_set_system_fn(system)

          popen = mod.addFunction((cmd_ptr: number, mode: number) => {
            console.log(mode)
            // todo: check it is indeed exec'ing postgres
            pg.Module.FS = mod.FS
            let cmd = ''
            let c = String.fromCharCode(mod.HEAPU8[cmd_ptr])
            while (c != '\0') {
              cmd += c
              c = String.fromCharCode(mod.HEAPU8[cmd_ptr++])
            }
            const postgresArgs = cmd.split(' ')
            postgresArgs.shift()
            let stderr = ''
            let stdout = ''
            const onPostgresPrint = (text: string) => stdout += text
            pg.addPrintCb(onPostgresPrint)
            const onPostgresPrintErr = (text: string) => stderr += text
            pg.addPrintErrCb(onPostgresPrintErr)
            const result = pg.callMain(postgresArgs)
            console.log(result)
            pg.removePrintCb(onPostgresPrint)
            pg.removePrintErrCb(onPostgresPrintErr)
            return 99; // this is supposed to be a file descriptor
          }, 'ppi')

          mod._pgl_set_popen_fn(popen)
        }
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

/**
 * Execute pg_dump
 */
export async function initdb({
  pg,
  args
}: InitdbOptions) {



  const execResult = await execInitdb({
    pg,
    args: [initdbExePath, ...(args ?? [])],
  })

  if (execResult.exitCode !== 0) {
    throw new Error(
      `initdb failed with exit code ${execResult.exitCode}. \nError message: ${execResult.stderr}`,
    )
  }

  return execResult.exitCode
}
