import { PGlite } from '@electric-sql/pglite'
import InitdbModFactory, { InitdbMod } from './initdbModFactory'

/**
 * Creates a new Uint8Array based on two different ArrayBuffers
 *
 * @private
 * @param {ArrayBuffers} buffer1 The first buffer.
 * @param {ArrayBuffers} buffer2 The second buffer.
 * @return {ArrayBuffers} The new ArrayBuffer created out of the two.
 */
function concat(buffer1: ArrayBuffer, buffer2: ArrayBuffer) {
  const tmp = new Uint8Array(buffer1.byteLength + buffer2.byteLength)
  tmp.set(new Uint8Array(buffer1), 0)
  tmp.set(new Uint8Array(buffer2), buffer1.byteLength)
  return tmp
}

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
  let pgdump_write, pgdump_read, system
  let exitStatus = 0
  let stderrOutput: string = ''
  let stdoutOutput: string = ''
  const emscriptenOpts: Partial<InitdbMod> = {
    arguments: args,
    noExitRuntime: false,
    print: (text) => {
      stdoutOutput += text
    },
    printErr: (text) => {
      stderrOutput += text
    },
    onExit: (status: number) => {
      exitStatus = status
    },
    preRun: [
      (mod: InitdbMod) => {
        mod.onRuntimeInitialized = () => {
          let bufferedBytes: Uint8Array = new Uint8Array()

          pgdump_write = mod.addFunction((ptr: any, length: number) => {
            let bytes
            try {
              bytes = mod.HEAPU8.subarray(ptr, ptr + length)
            } catch (e: any) {
              console.error('error', e)
              throw e
            }
            const currentResponse = pg.execProtocolRawSync(bytes)
            bufferedBytes = concat(bufferedBytes, currentResponse)
            return length
          }, 'iii')

          pgdump_read = mod.addFunction((ptr: any, max_length: number) => {
            let length = bufferedBytes.length
            if (length > max_length) {
              length = max_length
            }
            try {
              mod.HEAP8.set(bufferedBytes.subarray(0, length), ptr)
            } catch (e) {
              console.error(e)
            }
            bufferedBytes = bufferedBytes.subarray(length, bufferedBytes.length)
            return length
          }, 'iii')

          mod._pgl_set_rw_cbs(pgdump_read, pgdump_write)
          // default $HOME in emscripten is /home/web_user
          mod.FS.chmod('/home/web_user/.pgpass', 0o0600) // https://www.postgresql.org/docs/current/libpq-pgpass.html

          system = mod.addFunction((cmd: string[]) => {
            return pg.callMain(cmd)
          }, 'vi')

          mod._pgl_set_system_fn(system)
        }
      },
    ],
  }

  await InitdbModFactory(emscriptenOpts)

  return {
    exitCode: exitStatus,
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

  const baseArgs = [
    '-U',
    'postgres',
    '--inserts',
    '-j',
    '1',
    '-f',
    'postgres',
  ]

  const execResult = await execInitdb({
    pg,
    args: [...(args ?? []), ...baseArgs],
  })

  if (execResult.exitCode !== 0) {
    throw new Error(
      `initdb failed with exit code ${execResult.exitCode}. \nError message: ${execResult.stderr}`,
    )
  }

  return execResult.exitCode
}
