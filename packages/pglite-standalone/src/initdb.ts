import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Instance } from './instance.js'
import { PGDATA, defaultEnv } from './defaults.js'

/**
 * Create PGDATA with initdb-standalone.wasm, like initdb.ts in the pglite package.
 *
 * initdb runs postgres as a subprocess, through the pglite.exec import. We run
 * each command in a fresh postgres instance, copying PGDATA in before and back
 * out after: as the two take turns, that works like a shared filesystem.
 */

const POSTGRES = '/pglite/bin/postgres'
const INITDB = '/pglite/bin/initdb'
const PIPE_TO_CHILD = '/pglite/pgstdin'
const PIPE_FROM_CHILD = '/pglite/pgstdout'

/** As in initdb.ts */
export const defaultInitdbArgs = [
  '--allow-group-access',
  '--encoding',
  'UTF8',
  '--locale=C.UTF-8',
  '--locale-provider=libc',
  '--auth=trust',
]

export interface InitdbOptions {
  /** The compiled initdb-standalone.wasm */
  initdbModule: WebAssembly.Module
  /** The compiled pglite-standalone.wasm */
  postgresModule: WebAssembly.Module
  /** The runtime filesystem tarballs (pglite-standalone-fs.tar.gz) */
  fs: Uint8Array[]
  args?: string[]
}

/** The arguments of a shell command, up to the first redirection */
export function commandArgs(command: string): string[] {
  const args: string[] = []
  // words made of unquoted, 'single quoted' and "double quoted" parts
  const word = /(?:[^\s'"\\]+|'[^']*'|"(?:[^"\\]|\\.)*"|\\.)+/g
  for (const [token] of command.matchAll(word)) {
    if (/^\d*[<>]/.test(token)) break
    args.push(
      token.replace(/'([^']*)'|"((?:[^"\\]|\\.)*)"|\\(.)/g, (_m, s, d, e) =>
        s !== undefined ? s : d !== undefined ? d.replace(/\\(.)/g, '$1') : e,
      ),
    )
  }
  return args
}

/** Run initdb, and return the new PGDATA as an (uncompressed) tarball */
export function initdb(opts: InitdbOptions): Uint8Array {
  const workdir = mkdtempSync(join(tmpdir(), 'pglite-initdb-'))
  const output: string[] = [] // what initdb and its subprocesses printed
  const logFile = (name: string) => openSync(join(workdir, name), 'w+')
  const readLog = (name: string) => readFileSync(join(workdir, name), 'utf8')

  function runPostgres(
    args: string[],
    pgdata: Uint8Array | undefined,
    stdin: Uint8Array | undefined,
  ) {
    const stderr = logFile('postgres.err')
    try {
      // initdb unsets PGCLIENTENCODING for its subprocesses
      const { PGCLIENTENCODING: _, ...env } = defaultEnv
      const pg = new Instance(opts.postgresModule, { env, stderr })
      for (const tarball of opts.fs) pg.loadTar(tarball, '/')
      if (pgdata) pg.loadTar(pgdata, PGDATA)
      // as in initdb.ts: stdin and stdout are files, which pgl_exit() flushes
      if (stdin) {
        pg.writeFile(PIPE_TO_CHILD, stdin)
        pg.freopen(PIPE_TO_CHILD, 'r', 0)
      }
      pg.freopen(PIPE_FROM_CHILD, 'w', 1)
      const code = pg.callMain([POSTGRES, ...args])
      return {
        code,
        stdout: pg.readFile(PIPE_FROM_CHILD),
        pgdata: pg.dumpTar(PGDATA, true),
      }
    } finally {
      closeSync(stderr)
      output.push(readLog('postgres.err'))
    }
  }

  const stdout = logFile('initdb.out')
  const stderr = logFile('initdb.err')
  let logsOpen = true
  const closeLogs = () => {
    if (logsOpen) {
      closeSync(stdout)
      closeSync(stderr)
      logsOpen = false
    }
  }
  try {
    const instance: Instance = new Instance(opts.initdbModule, {
      env: defaultEnv,
      stdout,
      stderr,
      // pglite.exec: run a postgres command for initdb
      exec: (pCommand, pStdinPath, pStdoutPath) => {
        const command = instance.string(pCommand)
        const args = commandArgs(command)
        if (args[0] !== POSTGRES) {
          output.push(`initdb: cannot run ${JSON.stringify(command)}\n`)
          return -1
        }
        const stdin = pStdinPath
          ? instance.readFile(instance.string(pStdinPath))
          : undefined
        // PGDATA does not exist yet when initdb checks the postgres version
        const res = runPostgres(
          args.slice(1),
          instance.dumpTar(PGDATA, true),
          stdin,
        )
        if (res.pgdata) {
          instance.removeTree(PGDATA)
          instance.loadTar(res.pgdata, PGDATA)
        }
        if (pStdoutPath) {
          instance.writeFile(instance.string(pStdoutPath), res.stdout)
        }
        return res.code
      },
    })
    for (const tarball of opts.fs) instance.loadTar(tarball, '/')

    const code = instance.callMain([
      INITDB,
      ...(opts.args ?? defaultInitdbArgs),
    ])
    closeLogs()
    output.push(readLog('initdb.out'), readLog('initdb.err'))
    if (code !== 0) {
      throw new Error(`initdb failed (exit code ${code}):\n${output.join('')}`)
    }
    return instance.dumpTar(PGDATA)
  } finally {
    closeLogs()
    rmSync(workdir, { recursive: true, force: true })
  }
}
