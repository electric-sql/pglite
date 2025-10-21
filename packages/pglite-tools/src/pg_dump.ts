import { PGlite } from '@electric-sql/pglite'
import PgDumpModFactory, { PgDumpMod } from './pgDumpModFactory'

const IN_NODE =
  typeof process === 'object' &&
  typeof process.versions === 'object' &&
  typeof process.versions.node === 'string'

async function getFsBundle(): Promise<ArrayBuffer> {
  const fsBundleUrl = new URL('../release/pg_dump.data', import.meta.url)
  if (IN_NODE) {
    const fs = await import('fs/promises')
    const fileData = await fs.readFile(fsBundleUrl)
    return fileData.buffer
  } else {
    const response = await fetch(fsBundleUrl)
    return response.arrayBuffer()
  }
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
}): Promise<[number, string, string]> {
  // const bin = new URL('./pg_dump.wasm', import.meta.url)
  let pgdump_write, pgdump_read

  const fsBundleBuffer = await getFsBundle()

  const emscriptenOpts: Partial<PgDumpMod> = {
    arguments: args,
    noExitRuntime: false,
    getPreloadedPackage: (remotePackageName, remotePackageSize) => {
      if (remotePackageName === 'pg_dump.data') {
        if (fsBundleBuffer.byteLength !== remotePackageSize) {
          throw new Error(
            `Invalid FS bundle size: ${fsBundleBuffer.byteLength} !== ${remotePackageSize}`,
          )
        }
        return fsBundleBuffer
      }
      throw new Error(`Unknown package: ${remotePackageName}`)
    },
    preRun: [
      (mod: PgDumpMod) => {
        mod.onRuntimeInitialized = () => {
          let currentResponse: Uint8Array = new Uint8Array()
          let currentReadOffset = 0
          pgdump_write = mod.addFunction((ptr: any, length: number) => {
            let bytes
            try {
              bytes = mod.HEAPU8.subarray(ptr, ptr + length)
            } catch (e: any) {
              console.error('error', e)
              throw e
            }
            currentResponse = pg.execProtocolRawSync(bytes)
            currentReadOffset = 0
            return length
          }, 'iii')

          pgdump_read = mod.addFunction((ptr: any, max_length: number) => {
            // copy current data to wasm buffer
            let length = currentResponse.length - currentReadOffset
            if (length > max_length) {
              length = max_length
            }
            try {
              mod.HEAP8.set(
                currentResponse.subarray(
                  currentReadOffset,
                  currentReadOffset + length,
                ),
                ptr,
              )
              currentReadOffset += length
            } catch (e) {
              console.log(e)
            }
            return length
          }, 'iii')
          mod._set_read_write_cbs(pgdump_read, pgdump_write)
          mod.FS.chmod('/home/web_user/.pgpass', 0o0600) // https://www.postgresql.org/docs/current/libpq-pgpass.html
        }
      },
    ],
  }

  const mod = await PgDumpModFactory(emscriptenOpts)

  const bytes = mod.FS.readFile('/tmp/out.sql', { encoding: 'utf8' })

  return [0, bytes, '']
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

  const file = new File([acc], fileName, {
    type: 'text/plain',
  })
  // pg.Module.FS.unlink(outFile)

  return file
}

// Wire protocol messages for simulating auth handshake:

// function charToByte(char: string) {
//   return char.charCodeAt(0)
// }

// // Function to convert an integer to a 4-byte array (Int32)
// function int32ToBytes(value: number) {
//   const buffer = new ArrayBuffer(4)
//   const view = new DataView(buffer)
//   view.setInt32(0, value, false) // false for big-endian
//   return new Uint8Array(buffer)
// }

// Convert a string to a Uint8Array with a null terminator (C string)
// function stringToBytes(str: string) {
//   const utf8Encoder = new TextEncoder()
//   const strBytes = utf8Encoder.encode(str) // UTF-8 encoding
//   return new Uint8Array([...strBytes, 0]) // Append null terminator
// }

// const authOk = new Uint8Array([
//   charToByte('R'),
//   ...int32ToBytes(8),
//   ...int32ToBytes(0),
// ])
// const readyForQuery = new Uint8Array([
//   charToByte('Z'),
//   ...int32ToBytes(5),
//   charToByte('I'),
// ])

// const svParamName = stringToBytes('server_version')
// const svParamValue = stringToBytes('16.3 (PGlite 0.2.0)')
// const svTotalLength = 4 + svParamName.length + svParamValue.length
// const versionParam = new Uint8Array([
//   charToByte('S'),
//   ...int32ToBytes(svTotalLength),
//   ...svParamName,
//   ...svParamValue,
// ])
