import { PGlite } from '@electric-sql/pglite'
import InitdbModFactory, { InitdbMod } from './initdbModFactory'
import parse from './argsParser'

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
  let system_fn, popen_fn, pclose_fn
  // let fgets_fn, fputs_fn
  // let read_fn, write_fn
  let initdbStderr: number[] = []
  let initdbStdout: number[] = []
  let pgstderr: number[] = []
  let pgstdout: number[] = []
  let pgstdin: number[] = []
  let needToCallPGmain = false
  let postgresArgs: string[] = []
  let onPGstdout = (c: number) => pgstdout.push(c)
  let onPGstderr = (c: number) => pgstderr.push(c)
  let onPGstdin = () => { return pgstdin.length ? pgstdin.shift() : null }
  let prevPGstdin: any
  let pgliteinout_fd: number
  let cwd = '/'

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

  const initdb_stderr = (c: number): any => {
    initdbStderr.push(c)
    // console.log('stderr called', c)
  }
  
  const emscriptenOpts: Partial<InitdbMod> = {
    arguments: args,
    noExitRuntime: false,
    thisProgram: initdbExePath,
    // print: (text) => {
    //   stdoutOutput += text
    // },
    // printErr: (text) => {
    //   stderrOutput += text
    // },
    preRun: [
      (mod: InitdbMod) => {
        mod.FS.init(initdb_stdin, initdb_stdout, initdb_stderr)
      },
      (mod: InitdbMod) => {
        mod.onRuntimeInitialized = () => {
          // default $HOME in emscripten is /home/web_user
          system_fn = mod.addFunction((cmd_ptr: number) => {
            // todo: check it is indeed exec'ing postgres
            const postgresArgs = getArgs(mod.HEAPU8, cmd_ptr)
            postgresArgs.shift()
            cwd = mod.FS.cwd()
            pg.__FS!.chdir(cwd)
            return pg.callMain(postgresArgs)
          }, 'pi')

          mod._pgl_set_system_fn(system_fn)

          popen_fn = mod.addFunction((cmd_ptr: number, mode: number) => {
            // console.log(mode)
            // todo: check it is indeed exec'ing postgres
            const smode = String.fromCharCode(mod.HEAPU8[mode])
            postgresArgs = getArgs(mod.HEAPU8, cmd_ptr)
            postgresArgs.shift()
            pg.addStdoutCb(onPGstdout)
            pg.addStderrCb(onPGstderr)
            if (smode === 'r') {
              cwd = mod.FS.cwd()
              pg.__FS!.chdir(cwd)
              pg.callMain(postgresArgs)
              // console.log(result)
              pg.removeStdoutCb(onPGstdout)
              pg.removeStderrCb(onPGstderr)
            } else {
              if (smode === 'w') {
                cwd = mod.FS.cwd()
                // defer calling main until initdb exe has finished writing to pg's stdin
                prevPGstdin = pg.pgl_stdin
                pg.pgl_stdin = onPGstdin
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
              // if the last popen had mode w, execute now postgres' main()
              if (needToCallPGmain) {
                needToCallPGmain = false
                pg.__FS!.chdir(PGDATA)
                const result = pg.callMain(postgresArgs)
                // console.log(result)
                pg.removeStdoutCb(onPGstdout)
                pg.removeStderrCb(onPGstderr)
                pg.pgl_stdin = prevPGstdin
                pgstdin = []
                const closeResult = mod._fclose(stream)
                console.log(closeResult)
                return result
              }
            } else {
              return mod._pclose(stream)
            }

          }, 'pi')

          mod._pgl_set_pclose_fn(pclose_fn)          

          // read_fn = mod.addFunction((fd: number, buf: number, count: number) => {
          //   // console.log(str, size, stream)
          //   if (fd == 99) {
          //     if (pgstdout.length > count) throw 'PGlite: unhandled'
          //     mod.HEAPU8.set(pgstdout, buf)
          //     const result = pgstdout.length
          //     pgstdout = []
          //     return result
          //   } else {
          //     return mod._read(fd, buf, count);
          //   }
          // }, 'pipi')

          // mod._pgl_set_read_fn(read_fn)

          // fgets_fn = mod.addFunction((str: number, size: number, stream: number) => {
          //   // console.log(str, size, stream)
          //   if (stream == 99) {
          //     if (pgstdout.length) {
          //       let i = 0
          //       let arr = new Array<number>()
          //       while (i < size - 1 && i < pgstdout.length) {
          //         arr.push(pgstdout[i])
          //         if (pgstdout[i++] === '\n'.charCodeAt(0)) {
          //           break;
          //         }
          //       }
          //       // if (arr.length === pgstdout.length && pgstdout[pgstdout.length] !== '\n'.charCodeAt(0)) {
          //       //   arr.push('\n'.charCodeAt(0))
          //       // }
          //       pgstdout = pgstdout.slice(i)
          //       if (arr.length) {
          //         arr.push('\0'.charCodeAt(0))
          //         mod.HEAP8.set(arr, str)
          //         return str
          //       }
          //       return null;
          //     } else {
          //       return null;
          //     }
          //   } else {
          //     // mod._pgl_set_errno(1);
          //     return mod._fgets(str, size, stream);
          //     // throw 'PGlite: unknown stream'
          //   }
          // }, 'pipp')

          // mod._pgl_set_fgets_fn(fgets_fn)

          // ssize_t write(int fd, const void *buf, size_t count);
          // write_fn = mod.addFunction((fd: number, buf: number, count: number) => {
          //   // console.log(str, size, stream)
          //   if (fd == 99) {
          //     const values = mod.HEAPU8.subarray(buf, count)
          //     pgstdin.push(...values)
          //     return count
          //   } else {
          //     return mod._write(fd, buf, count)
          //   }
          // }, 'pipi')

          // mod._pgl_set_write_fn(write_fn)

          // fputs_fn = mod.addFunction((s: number, stream: number) => {
          //   // console.log(str, size, stream)
          //   if (stream == 99) {
          //     while (1) {
          //       const curr = mod.HEAP8.at(s++)
          //       if (curr === '\0'.charCodeAt(0)) {
          //         break;
          //       } 
          //       pgstdin.push(curr!)
          //     }
          //     return s;
          //   } else {
          //     return mod._fputs(s, stream);
          //   }
          // }, 'ppi')

          // mod._pgl_set_fputs_fn(fputs_fn)
        }
      },
      (mod: InitdbMod) => {
        mod.ENV.PGDATA = PGDATA
      },
      (mod: InitdbMod) => {
        mod.FS.mkdir('/pglite');
        mod.FS.mount(mod.PROXYFS, {
          root: '/pglite',
          fs: pg.__FS!
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

function getArgs(HEAPU8: Uint8Array, cmd_ptr: number) {
  let cmd = ''
  let c = String.fromCharCode(HEAPU8[cmd_ptr++])
  while (c != '\0') {
    cmd += c
    c = String.fromCharCode(HEAPU8[cmd_ptr++])
  }
  let postgresArgs: string[] = []
  let parsed = parse(cmd)
  for (let i = 0; i < parsed.length; i++) {
    if (parsed[i].op) break;
    postgresArgs.push(parsed[i])
  }
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
