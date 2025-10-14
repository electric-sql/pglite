import { WasiPreview1 } from './wasi/easywasi'
import { postgresMod } from '@electric-sql/pglite'
import { PGlite } from '@electric-sql/pglite'

type FS = postgresMod.FS
type FSInterface = any // WASI FS interface

const IN_NODE =
  typeof process === 'object' &&
  typeof process.versions === 'object' &&
  typeof process.versions.node === 'string'

/**
 * Emscripten FS is not quite compatible with WASI
 * so we need to patch it
 */
function emscriptenFsToWasiFS(fs: FS, acc: any[]): FSInterface & FS {
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
          return [
            method,
            (...args: any[]) => {
              if (method === 'writeFileSync' && args[0] === '/tmp/out.sql') {
                acc.push(args[1])
              }
              return (fs as any)[target](...args)
            },
          ]
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
async function execPgDump({
  pg,
  args,
}: {
  pg: PGlite
  args: string[]
}): Promise<[number, Uint8Array[], string]> {
  const bin = new URL('./pg_dump.wasm', import.meta.url)
  const acc: Uint8Array[] = []
  const FS = emscriptenFsToWasiFS(pg.Module.FS, acc)

  const wasi = new WasiPreview1({
    fs: FS,
    args: ['pg_dump', ...args],
    env: {
      PWD: '/',
    },
  })

  wasi.stdout = (_buffer) => {
    // console.log('stdout', _buffer)
  }
  const textDecoder = new TextDecoder()
  let errorMessage = ''

  wasi.stderr = (_buffer) => {
    const text = textDecoder.decode(_buffer)
    if (text) errorMessage += text
  }
  wasi.sched_yield = () => {
    const pgIn = '/tmp/pglite/base/.s.PGSQL.5432.in'
    const pgOut = '/tmp/pglite/base/.s.PGSQL.5432.out'
    if (FS.analyzePath(pgIn).exists) {
      // call interactive one
      const msgIn = FS.readFileSync(pgIn)

      // BYPASS the file socket emulation in PGlite
      FS.unlinkSync(pgIn)

      // Handle auth request
      if (msgIn[0] === 0) {
        const reply = new Uint8Array([
          ...authOk,
          ...versionParam,
          ...readyForQuery,
        ])
        FS.writeFileSync(pgOut, reply)
        return 0
      }

      // Handle query
      const reply = pg.execProtocolRawSync(msgIn)
      FS.writeFileSync(pgOut, reply)
    }
    return 0
  }

  // Postgres can complain if the binary is not on the filesystem
  // so we create a dummy file
  await FS.writeFile('/pg_dump', '\0', { mode: 18 })

  let app: WebAssembly.WebAssemblyInstantiatedSource

  if (IN_NODE) {
    const fs = await import('fs/promises')
    const blob = await fs.readFile(bin)
    app = await WebAssembly.instantiate(blob, {
      wasi_snapshot_preview1: wasi as any,
    })
  } else {
    app = await WebAssembly.instantiateStreaming(fetch(bin), {
      wasi_snapshot_preview1: wasi as any,
    })
  }

  let exitCode: number
  await pg.runExclusive(async () => {
    exitCode = wasi.start(app.instance.exports)
  })

  return [exitCode!, acc, errorMessage]
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
  const getSearchPath = await pg.query<{ search_path: string }>(
    'SHOW SEARCH_PATH;',
  )
  const search_path = getSearchPath.rows[0].search_path

  const outFile = `/tmp/out.sql`
  const baseArgs = [
    '-U',
    'postgres',
    '--inserts',
    '-j',
    '1',
    '-f',
    outFile,
    'postgres',
  ]

  const [exitCode, acc, errorMessage] = await execPgDump({
    pg,
    args: [...(args ?? []), ...baseArgs],
  })

  pg.exec(`DEALLOCATE ALL; SET SEARCH_PATH = ${search_path}`)

  if (exitCode !== 0) {
    throw new Error(
      `pg_dump failed with exit code ${exitCode}. \nError message: ${errorMessage}`,
    )
  }

  const file = new File(acc, fileName, {
    type: 'text/plain',
  })
  pg.Module.FS.unlink(outFile)

  return file
}

// Wire protocol messages for simulating auth handshake:

function charToByte(char: string) {
  return char.charCodeAt(0)
}

// Function to convert an integer to a 4-byte array (Int32)
function int32ToBytes(value: number) {
  const buffer = new ArrayBuffer(4)
  const view = new DataView(buffer)
  view.setInt32(0, value, false) // false for big-endian
  return new Uint8Array(buffer)
}

// Convert a string to a Uint8Array with a null terminator (C string)
function stringToBytes(str: string) {
  const utf8Encoder = new TextEncoder()
  const strBytes = utf8Encoder.encode(str) // UTF-8 encoding
  return new Uint8Array([...strBytes, 0]) // Append null terminator
}

const authOk = new Uint8Array([
  charToByte('R'),
  ...int32ToBytes(8),
  ...int32ToBytes(0),
])
const readyForQuery = new Uint8Array([
  charToByte('Z'),
  ...int32ToBytes(5),
  charToByte('I'),
])

const svParamName = stringToBytes('server_version')
const svParamValue = stringToBytes('16.3 (PGlite 0.2.0)')
const svTotalLength = 4 + svParamName.length + svParamValue.length
const versionParam = new Uint8Array([
  charToByte('S'),
  ...int32ToBytes(svTotalLength),
  ...svParamName,
  ...svParamValue,
])
