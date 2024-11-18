import { WASIInstance, WasiPreview1, FSInterface } from '../wasi'
import { FS } from '../postgresMod'
import { PGlite } from '../pglite'

/**
 * Emscripten FS is not quite compatible with WASI
 * so we need to patch it
 */
function emscriptenFsToWasiFS(fs: FS): FSInterface & FS {
  const requiredMethods = [
    'appendFileSync',
    'fsyncSync',
    'linkSync',
    'setFlagsSync',
    'mkdirSync',
    'readdirSync',
    'readFileSync',
    'readlinkSync',
    'renameSync',
    'rmdirSync',
    'statSync',
    'symlinkSync',
    'truncateSync',
    'unlinkSync',
    'utimesSync',
    'writeFileSync',
  ]
  return {
    // Bind all methods to the FS instance
    ...fs,
    // Add missing methods
    ...Object.fromEntries(
      requiredMethods
        .map((method) => {
          const target = method.slice(0, method.length - 4)
          if (!(target in fs)) {
            return [
              method,
              () => {
                throw new Error(`${target} not implemented.`)
              },
            ]
          }
          return [method, (fs as any)[target].bind(fs)]
        })
        .filter(
          (entry): entry is [string, (fs: FS) => any] => entry !== undefined,
        ),
    ),
  } as FSInterface & FS
}

/**
 * Inner function to execute pg_dump
 */
async function execPgDump({ pg, args }: { pg: PGlite; args: string[] }) {
  const bin = new URL('../../release/pg_dump.wasm', import.meta.url).href
  const FS = emscriptenFsToWasiFS(pg.Module.FS)

  const wasi = new WasiPreview1({
    fs: FS,
    args: ['pg_dump', ...args],
    env: {
      PWD: '/',
    },
    onSchedYield: () => {
      const pg_in = '/tmp/pglite/base/.s.PGSQL.5432.in'
      const pg_out = '/tmp/pglite/base/.s.PGSQL.5432.out'
      if (FS.analyzePath(pg_in).exists) {
        // call interactive one
        const sf_data = FS.readFileSync(pg_in)
        pg.Module._interactive_one()
        const fstat = FS.stat(pg_out)
        console.log('socket file', sf_data.length, 'pgreply', fstat.size)
      } else {
        console.log('sched_yield - no aio')
      }
    },
  })

  // @ts-expect-error
  await FS.writeFile('/pg_dump', '\0', { mode: 18 })

  const app = await WebAssembly.instantiateStreaming(fetch(bin), {
    wasi_snapshot_preview1: wasi as any,
  })

  let exitCode: number
  await pg.runExclusive(async () => {
    exitCode = wasi.start(app.instance as WASIInstance)
  })
  return exitCode!
}

interface PgDumpOptions {
  pg: PGlite
  args?: string[]
  outFile?: string
}

/**
 * Execute pg_dump
 */
export async function pgDump({
  pg,
  args,
  outFile = 'dump.sql',
}: PgDumpOptions) {
  if (!args) {
    args = [
      '-U',
      'postgres',
      '--inserts',
      '-j',
      '1',
      '-v',
      '-c',
      '-C',
      '--disable-dollar-quoting',
      'postgres',
    ]
  }
  const FS = pg.Module.FS
  const exitCode = await execPgDump({ pg, args: ['-f', outFile, ...args] })
  if (exitCode !== 0) {
    throw new Error(`pg_dump failed with exit code ${exitCode}`)
  }
  return new File([FS.readFile(outFile)], 'dump.sql', {
    type: 'text/plain',
  })
}
