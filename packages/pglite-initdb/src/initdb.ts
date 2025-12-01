import { PGlite } from '@electric-sql/pglite'
import InitdbModFactory, { InitdbMod } from './initdbModFactory'
import parse from './argsParser'
import assert from 'assert'
import fs from 'node:fs'

export const PGDATA = '/pglite/data'

const initdbExePath = '/pglite/bin/initdb'
// "-c", "zero_damaged_pages=on"
const baseArgs = [
"-c", "log_checkpoints=false",
"-c", "search_path=pg_catalog",
"-c", "exit_on_error=true",
"-c", "ignore_invalid_pages=on",
"-c", "temp_buffers=8MB",
"-c", "work_mem=4MB",
"-c", "fsync=on",
"-c", "synchronous_commit=on",
"-c", "wal_buffers=4MB",
"-c", "min_wal_size=80MB",
"-c", "shared_buffers=128MB"]

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
  let system_fn, popen_fn, pclose_fn, pipe_fn
  // let fgets_fn, fputs_fn
  // let read_fn, write_fn
  // let initdbStderr: number[] = []
  let initdbStdout: number[] = []
  let pgstderr: number[] = []
  let pgstdout: number[] = []
  let pgstdin: number[] = []
  let needToCallPGmain = false
  let postgresArgs: string[] = []
  let onPGstdout = (c: number) => pgstdout.push(c)
  let onPGstderr = (c: number) => pgstderr.push(c)
  let onPGstdin = () => { return pgstdin.length ? pgstdin.shift() : null }
  let pgliteinout_fd: number
  let pgMainResult = 0
  let i = 0
  const callPgMain = (args: string[]) => {
    const firstArg = args.shift()
    console.log('firstArg', firstArg)
    assert(firstArg === '/pglite/bin/postgres', `trying to execute ${firstArg}`)

    const stat = pg.Module.FS.analyzePath(PGDATA)
    if (stat.exists) {
      pg.Module.FS.chdir(PGDATA)
    }
    const prevPGstdin = pg.pgl_stdin
    pg.pgl_stdin = onPGstdin
    pg.addStdoutCb(onPGstdout)
    pg.addStderrCb(onPGstderr)
    pgstderr = []
    pgstdout = []
    pg.Module.HEAPU8.set(origHEAPU8)

    if (args[0] === '--single' || args[0] === '--boot') {
      if (args[args.length-1] !== 'template1') {
        args.push(...baseArgs)
      } else {
        const x = args.pop()
        args.push(...baseArgs, x!)
      }
    }

    fs.writeFileSync(`/tmp/pgstdin${i++}`, new TextDecoder().decode(new Uint8Array(pgstdin)))
    console.log('executing pg main with', args)
    const result = pg.callMain(args)
    console.log(result)

    pg.removeStdoutCb(onPGstdout)
    pg.removeStderrCb(onPGstderr)
    pg.pgl_stdin = prevPGstdin
    postgresArgs = []
    pgstdin = []
    return result
  }  

  const initdb_stdin = (): number | null => {
    console.log('stdin called')
    if (pgstdout.length) {
      return pgstdout.shift() ?? null
    } else {
      return null
    }
  }

  const initdb_stdout = (c: number): any => {
    // if (this.debug) {
    //   console.debug(text)
    // }
    initdbStdout.push(c)
  }

  // const initdb_stderr = (c: number): any => {
  //   initdbStderr.push(c)
  //   // console.log('stderr called', c)
  // }
  
  const origHEAPU8 = pg.Module.HEAPU8.slice()

  const emscriptenOpts: Partial<InitdbMod> = {
    arguments: args,
    noExitRuntime: false,
    thisProgram: initdbExePath,
    // print: (text) => {
    //   stdoutOutput += text
    // },
    printErr: (text) => {
      console.error("initdberr", text)
    },
    preRun: [
      (mod: InitdbMod) => {
        mod.FS.init(initdb_stdin, initdb_stdout, null)
      },
      (mod: InitdbMod) => {
        mod.onRuntimeInitialized = () => {
          // default $HOME in emscripten is /home/web_user
          system_fn = mod.addFunction((cmd_ptr: number) => {
            // todo: check it is indeed exec'ing postgres
            const args = getArgs(mod.UTF8ToString(cmd_ptr))
            const pgMainReturn = callPgMain(args)
            return pgMainReturn
          }, 'pi')

          mod._pgl_set_system_fn(system_fn)

          popen_fn = mod.addFunction((cmd_ptr: number, mode: number) => {
            // console.log(mode)
            // todo: check it is indeed exec'ing postgres
            const smode = mod.UTF8ToString(mode)
            const args = getArgs(mod.UTF8ToString(cmd_ptr))

            if (smode === 'r') {
              // cwd = mod.FS.cwd()
              // we need the result to return it on pclose()
              pgMainResult = callPgMain(args)
            } else {
              if (smode === 'w') {
                postgresArgs = args
                // cwd = mod.FS.cwd()
                // defer calling main until initdb exe has finished writing to pg's stdin
                needToCallPGmain = true
              } else {
                throw `Unexpected popen mode value ${smode}`
              }
            }
            const path = mod.allocateUTF8('/dev/pgliteinout')
            pgliteinout_fd = mod._fopen(path, mode);
            if (pgliteinout_fd === -1) {
              const errno = mod.HEAPU8[mod.___errno_location()]
              let error = mod._strerror(errno)
              let errstr = mod.UTF8ToString(error)
              console.error('errno error', errno , errstr)
              throw errstr
            }
            return pgliteinout_fd;
          }, 'ppi')

          mod._pgl_set_popen_fn(popen_fn)

          pclose_fn = mod.addFunction((stream: number) => {
            if (stream === pgliteinout_fd) {
              let result = 0
              // if the last popen had mode w, execute now postgres' main()
              if (needToCallPGmain) {
                needToCallPGmain = false
                result = callPgMain(postgresArgs)
                return result
              }
              const closeResult = mod._fclose(stream)
              console.log(closeResult)
              return pgMainResult
            } else {
              return mod._pclose(stream)
            }

          }, 'pi')

          mod._pgl_set_pclose_fn(pclose_fn)
          
          pipe_fn = mod.addFunction((fd: number) => {
            console.log(fd)
            return 0;
          }, 'pi')

          mod._pgl_set_pipe_fn(pipe_fn)
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
      (mod: InitdbMod) => {
        // Register /dev/pgliteinout device
        const devId = mod.FS.makedev(64, 0)
        const devOpt = {
          open: (_stream: any) => {},
          close: (_stream: any) => {},
          read: (
            _stream: any,
            buffer: Uint8Array,
            offset: number,
            length: number,
            position: number,
          ) => {
            const contents = new Uint8Array(pgstdout)
            if (position >= contents.length) return 0
            const size = Math.min(contents.length - position, length)
            for (let i = 0; i < size; i++) {
              buffer[offset + i] = contents[position + i]
            }
            return size
          },
          write: (
            _stream: any,
            buffer: Uint8Array,
            offset: number,
            length: number,
            _position: number,
          ) => {
            assert(_position === pgstdin.length, `_position is ${_position}`)
            pgstdin.push(...buffer.slice(offset, offset + length))
            return length
          },
          // llseek: (_stream: any, _offset: number, _whence: number) => {}
        }
        mod.FS.registerDevice(devId, devOpt)
        mod.FS.mkdev('/dev/pgliteinout', devId)
      }
    ],
  }

  const initDbMod = await InitdbModFactory(emscriptenOpts)

  const result = initDbMod.callMain(args)

  return {
    exitCode: result,
    stderr: '', //stderrOutput,
    stdout: '', //stdoutOutput,
  }


}

interface InitdbOptions {
  pg: PGlite
  args?: string[]
}

function getArgs(cmd: string) {
  let a: string[] = []
  let parsed = parse(cmd)
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
  args
}: InitdbOptions) {



  const execResult = await execInitdb({
    pg,
    args: ["--wal-segsize=1", "--allow-group-access", "--no-sync", "-E", "UTF8", "--locale=C.UTF-8", "--locale-provider=libc",
      ...baseArgs, ...(args ?? [])],
  })

  if (execResult.exitCode !== 0) {
    throw new Error(
      `initdb failed with exit code ${execResult.exitCode}. \nError message: ${execResult.stderr}`,
    )
  }

  return execResult.exitCode
}
