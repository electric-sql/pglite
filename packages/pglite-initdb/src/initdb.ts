import { PGlite } from '@electric-sql/pglite'
import InitdbModFactory, { InitdbMod } from './initdbModFactory'
import parse from './argsParser'
import assert from 'assert'
// import fs from 'node:fs'

export const PGDATA = '/pglite/data'

const initdbExePath = '/pglite/bin/initdb'
const pgstdoutPath = '/pglite/pgstdout'
const pgstdinPath = '/pglite/pgstdin'

// "-c", "checkpoint_flush_after=1",
// const baseArgs = [
// "-c", "ignore_checksum_failure=on",
// // "-c", "log_checkpoints=false",
// // "-c", "search_path=pg_catalog",
// // "-c", "exit_on_error=true",
// "-c", "ignore_invalid_pages=on",
// "-c", "zero_damaged_pages=on",
// "-c", "ignore_system_indexes=on",
// // "-c", "temp_buffers=8MB",
// // "-c", "work_mem=4MB",
// "-c", "fsync=on",
// "-c", "synchronous_commit=on",
// // "-c", "wal_buffers=4MB",
// // "-c", "min_wal_size=80MB",
// // "-c", "shared_buffers=128MB"
// ]

// const baseArgs: string[] = []

const baseArgs = [
  "-d", "4",
  "-D", PGDATA,
  // "-c", "exit_on_error=true",
  // "-c", "checkpoint_flush_after=1",
  "-c", "fsync=on", 
  // "-c", "synchronous_commit=on",
  // "-c", "effective_io_concurrency=1",
  // "-c", "maintenance_io_concurrency=1",
  // "-c", "backend_flush_after=1",
  // "-c", "io_combine_limit=1",
  "-c", "ignore_invalid_pages=on",
  "-c", "ignore_system_indexes=on",
  "-c", "ignore_checksum_failure=on",
  // "-c", "backend_flush_after=1",
  "-c", "zero_damaged_pages=on",

  "-c", "temp_buffers=8MB",
  "-c", "work_mem=4MB",
  "-c", "wal_buffers=4MB",
  "-c", "min_wal_size=80MB",
  "-c", "shared_buffers=128MB",
  "-c", "search_path=pg_catalog",
]

interface ExecResult {
  exitCode: number
  stderr: string
  stdout: string
}

async function execInitdb({
  pg,
  args,
}: {
  pg: PGlite
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

  const callPgMain = (args: string[]) => {
    const firstArg = args.shift()
    console.log('firstArg', firstArg)
    assert(firstArg === '/pglite/bin/postgres', `trying to execute ${firstArg}`)

    // const stat = pg.Module.FS.analyzePath(PGDATA)
    // if (stat.exists) {
    //   pg.Module.FS.chdir(PGDATA)
    // }

    if (args[0] === '--boot') {
      
      console.log("boot")
      args.push(...baseArgs)
      // args = [
      //   "--boot",
      //   "-D", PGDATA,
      //   "-d", "3",
      //   ...baseArgs,
      //   // "-r", "/dev/null",
      //   "-X", 
      //   "1048576"]
    }

    if (args[0] === '--single') {
      // process.exit(99)
      console.log("--single")
      if (args[args.length-1] === 'template1') {
        const x = args.pop()
        args.push(...baseArgs, "-B", "16", "-S", "512", "-f", "siobtnmh", x!)
        // args = [
        //   "--single",
        //   "-d", "3",
        //   "-B", "16", "-S", "512", "-f", "siobtnmh",
        //   "-D", PGDATA,
        //   "-O", "-j",
        //   // "-r", "/dev/null",
        //   x!
        // ]
      }
    }

    // if (args[0] === '--check') {
    //   args.push("-r", "/dev/null")
    // }

    // fs.writeFileSync(`/tmp/pgstdin${i_pgstdin}`, pg.Module.FS.readFile(pgstdinPath))
    // fs.writeFileSync(`/tmp/pgstdout${i_pgstdin++}`, pg.Module.FS.readFile(pgstdoutPath))

    // pg.Module.FS.writeFile(pgstdoutPath, '')
    pg.Module.HEAPU8.set(origHEAPU8)

    {
      const pglite_stdin_path = pg.Module.stringToUTF8OnStack(pgstdinPath)
      const rmode = pg.Module.stringToUTF8OnStack('r')
      pg.Module._pgl_freopen(pglite_stdin_path, rmode, 0)
      const pglite_stdout_path = pg.Module.stringToUTF8OnStack(pgstdoutPath)
      const wmode = pg.Module.stringToUTF8OnStack('w')
      pg.Module._pgl_freopen(pglite_stdout_path, wmode, 1)
    }    

    console.error('executing pg main with', args)
    const result = pg.callMain(args)
    // pg.Module.HEAPU8.set(origHEAPU8)
    // pg.Module._pgl_proc_exit(66)
    // pg.Module.___funcs_on_exit()
    // pg.Module._fflush(0);
    console.log("callMain result=", result)
    // pglite_stdin_fd && pg.Module._fclose(pglite_stdin_fd)
    // pglite_stdout_fd && pg.Module._fclose(pglite_stdout_fd)

    // pglite_stdin_fd = 0
    // pglite_stdout_fd = 0

    postgresArgs = []
    
    // pg.Module.FS.writeFile(pgstdinPath, '')

    // pg.Module.FS.writeFile('/pglite/pgstdout', new Uint8Array(pgstdout))
    return result
  }  

  const origHEAPU8 = pg.Module.HEAPU8.slice()

  const emscriptenOpts: Partial<InitdbMod> = {
    arguments: args,
    noExitRuntime: false,
    thisProgram: initdbExePath,
    print: (text) => {
      console.log("initdbout", text)
    },
    printErr: (text) => {
      console.error("initdberr", text)
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
              const initdb_path = mod.stringToUTF8OnStack(pgstdoutPath)
              const rmode = mod.stringToUTF8OnStack('r')
              initdb_stdin_fd = mod._fopen(initdb_path, rmode)

              return initdb_stdin_fd;
            } else {
              if (smode === 'w') {
                needToCallPGmain = true
                const path = mod.stringToUTF8OnStack(pgstdinPath)
                const wmode = mod.stringToUTF8OnStack('w')
                initdb_stdout_fd = mod._fopen(path, wmode)

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
                mod._fclose(stream)
                pgMainResult = callPgMain(postgresArgs)
              } else {
                mod._fclose(stream)
              }
              if (stream === initdb_stdin_fd) {
                initdb_stdin_fd = -1
              } else if (stream === initdb_stdout_fd) {
                initdb_stdout_fd = -1
              }
              // console.log(closeResult)
              return pgMainResult
            } else {
              return mod._pclose(stream)
            }

          }, 'pi')

          mod._pgl_set_pclose_fn(pclose_fn)
  
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
  args
}: InitdbOptions) {



  const execResult = await execInitdb({
    pg,
    args: ["--wal-segsize=1", "--allow-group-access", "-E", "UTF8", "--locale=C.UTF-8", "--locale-provider=libc",
      ...(args ?? [])],
  })

  if (execResult.exitCode !== 0) {
    throw new Error(
      `initdb failed with exit code ${execResult.exitCode}. \nError message: ${execResult.stderr}`,
    )
  }

  return execResult.exitCode
}
