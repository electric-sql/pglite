// import { WASIInstance, WasiPreview1, FSInterface } from '../wasi'
// import { WASIInstance, FSInterface } from '../wasi'
import { WasiPreview1 } from '../wasi/dev'
import { FS } from '../postgresMod'
import { PGlite } from '../pglite'

type FSInterface = any

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
  console.log('execPgDump', args)
  const bin = new URL('../../release/pg_dump.wasm', import.meta.url).href
  const FS = emscriptenFsToWasiFS(pg.Module.FS)

  const wasi = new WasiPreview1({
    fs: FS,
    // args: ['pg_dump', ...args],
    args: ["pg_dump", "-U", "postgres", "--inserts", "-j", "1", "-v", "-c", "-C", "-f", "/tmp/out.sql", "--disable-dollar-quoting", "postgres"],
    env: {
      PWD: '/',
    },
  })

  wasi.sched_yield = () => {
    console.log('onSchedYield')
    const pg_in = '/tmp/pglite/base/.s.PGSQL.5432.in'
    const pg_out = '/tmp/pglite/base/.s.PGSQL.5432.out'
    if (FS.analyzePath(pg_in).exists) {
      // call interactive one
      console.log('sched_yield - calling interactive_one')
      const sf_data = FS.readFileSync(pg_in)
      console.log('sched_yield - readFileSync', sf_data.length)
      pg.Module._interactive_one()
      console.log('sched_yield - interactive_one done')
      const fstat = FS.stat(pg_out)
      console.log('sched_yield socket file', sf_data.length, 'pgreply', fstat.size)
    } else {
      console.log('sched_yield - no aio')
    }
    console.log('onSchedYield done')
  },

  await FS.writeFile('/pg_dump', '\0', { mode: 18 })

  const app = await WebAssembly.instantiateStreaming(fetch(bin), {
    wasi_snapshot_preview1: wasi as any,
  })

  console.log('/tmp/pglite/base/', FS.readdir('/tmp/pglite/base/'))
  // FS.writeFile('/tmp/pglite/base/.s.PGSQL.5432.lock.in', '\0', { mode: 18 })

  let exitCode: number
  await pg.runExclusive(async () => {
    console.log('starting pg_dump')
    exitCode = wasi.start(app.instance.exports)
    console.log('pg_dump finished with exit code', exitCode)
  })
  return exitCode!
}

interface PgDumpOptions {
  pg: PGlite
  args?: string[]
  fileName?: string
}

/**
 * Execute pg_dump
 */
export async function pgDump({
  pg,
  args,
  fileName = 'dump.sql',
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
  const exitCode = await execPgDump({ pg, args: ['-f', 'out.sql', ...args] })
  if (exitCode !== 0) {
    throw new Error(`pg_dump failed with exit code ${exitCode}`)
  }
  // TODO: delete out.sql after reading
  return new File([FS.readFile('out.sql')], fileName, {
    type: 'text/plain',
  })
}
