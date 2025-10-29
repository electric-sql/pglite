import { PGlite } from '@electric-sql/pglite'
import PgDumpModFactory, { PgDumpMod } from './pgDumpModFactory'

/**
 * Inner function to execute pg_dump
 */
async function execPgDump({
  pg,
  args,
  verbose
}: {
  pg: PGlite
  args: string[]
  verbose: boolean
}): Promise<[number, string, string]> {
  let pgdump_write, pgdump_read
  let exitStatus = 0
  let stderrOutput: string = ''
  let stdoutOutput: string = ''
  const emscriptenOpts: Partial<PgDumpMod> = {
    arguments: args,
    noExitRuntime: false,
    print: (text) => {
      verbose && console.info("stdout:", text)
      stdoutOutput += text
    },
    printErr: (text) => {
      verbose && console.error("stderr:", text);
      stderrOutput += text;
    },
    onExit: (status: number) => {
      console.log("Program exited with status:", status);
      exitStatus = status
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
  let bytes = ''
  if (!exitStatus) {
    bytes = mod.FS.readFile('/tmp/out.sql', { encoding: 'utf8' })
  }
  
  return [exitStatus, bytes, stderrOutput]
}

interface PgDumpOptions {
  pg: PGlite
  args?: string[]
  fileName?: string
  verbose?: boolean
}

/**
 * Execute pg_dump
 */
export async function pgDump({
  pg,
  args,
  fileName = 'dump.sql',
  verbose = false
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

  if (verbose) baseArgs.push('--verbose')

  const [exitCode, acc, errorMessage] = await execPgDump({
    pg,
    args: [...(args ?? []), ...baseArgs],
    verbose
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

