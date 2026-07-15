import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import PostgresModFactory from '../release/pglite.js'
import type { PostgresMod } from './postgresMod.js'
import {
  ICU_DATA_PATH,
  INITDB_EXE_PATH,
  PGDATA,
  POSTGRES_EXE_PATH,
  runEmbeddedInitdb,
} from './initdb.js'
import type { PGliteClusterManifestV1 } from './initdb-runtime-contract.js'
import type { InitdbWorkerData } from './initdb-runtime-worker-types.js'
import {
  createClusterManifestFromFiles,
  encodingFromInitdbOutput,
} from './cluster-manifest.js'
import { pgliteRuntimeIdentity } from './runtime-identity.js'

export interface InitdbRuntimeHostIO {
  readByte(): number | null
  writeStdout(text: string): void
  writeStderr(text: string): void
}

export async function executeInitdbRuntime(
  data: InitdbWorkerData,
  io: InitdbRuntimeHostIO,
): Promise<{ exitCode: number; manifest?: PGliteClusterManifestV1 }> {
  const dataDir = resolve(data.dataDir)
  const previousExitCode = process.exitCode
  let postgres: PostgresMod | undefined
  try {
    const postgresWasmBytes = readFileSync(
      fileURLToPath(data.assets.postgresWasm),
    )
    const postgresDataBytes = readFileSync(
      fileURLToPath(data.assets.postgresData),
    )
    const initdbWasmBytes = readFileSync(fileURLToPath(data.assets.initdbWasm))
    const [postgresWasm, initdbWasm] = await Promise.all([
      WebAssembly.compile(postgresWasmBytes),
      WebAssembly.compile(initdbWasmBytes),
    ])
    const wasmMemory = new WebAssembly.Memory({
      initial: 2048,
      maximum: 32768,
    })
    const postgresData = exactArrayBuffer(postgresDataBytes)
    const environment = runtimeEnvironment(data.env)

    const initializedPostgres = await PostgresModFactory({
      thisProgram: POSTGRES_EXE_PATH,
      arguments: [],
      noExitRuntime: true,
      wasmMemory,
      stdin: () => null,
      print: io.writeStdout,
      printErr: io.writeStderr,
      instantiateWasm: (
        imports: WebAssembly.Imports,
        successCallback: (
          instance: WebAssembly.Instance,
          module: WebAssembly.Module,
        ) => void,
      ) => {
        imports.pglite = {
          ...(imports.pglite ?? {}),
          global_memory: wasmMemory,
          scoped_memory: wasmMemory,
        }
        void WebAssembly.instantiate(postgresWasm, imports).then((instance) => {
          // Emscripten's generated type omits its module argument.
          successCallback(instance, postgresWasm)
        })
        return {}
      },
      getPreloadedPackage: (name: string, size: number) => {
        if (name !== 'pglite.data') throw new Error(`Unknown package: ${name}`)
        if (postgresData.byteLength !== size) {
          throw new Error(
            `Invalid pglite.data size: ${postgresData.byteLength} !== ${size}`,
          )
        }
        return postgresData
      },
      preRun: [
        (mod: PostgresMod) => {
          Object.assign(mod.ENV, environment)
          const nodefs = mod.FS.filesystems.NODEFS
          if (!mod.FS.analyzePath(PGDATA).exists) mod.FS.mkdir(PGDATA)
          mod.FS.mount(nodefs, { root: dataDir }, PGDATA)
          mod.FS.chmod(INITDB_EXE_PATH, 0o555)
          mod.FS.chmod(POSTGRES_EXE_PATH, 0o555)
        },
      ],
    })
    postgres = initializedPostgres
    installBootstrapCommandHost(initializedPostgres)

    const argv = mapPgdataArguments(data.argv)
    let initdbStdout = ''
    const result = await runEmbeddedInitdb({
      pg: {
        Module: initializedPostgres,
        callMain: (args) => initializedPostgres.callMain(args),
      },
      args: argv,
      wasmModule: initdbWasm,
      stdin: () => io.readByte(),
      onStdout: (text) => {
        if (initdbStdout.length < 64 * 1024) initdbStdout += `${text}\n`
        io.writeStdout(text)
      },
      onStderr: io.writeStderr,
    })
    if (result.exitCode !== 0) return { exitCode: result.exitCode }

    const manifest = await createClusterManifest(
      dataDir,
      data.argv,
      data.coreVersion,
      encodingFromInitdbOutput(initdbStdout),
    )
    return { exitCode: 0, manifest }
  } finally {
    try {
      postgres?.FS.quit()
    } finally {
      process.exitCode = previousExitCode
    }
  }
}

function installBootstrapCommandHost(mod: PostgresMod): void {
  let externalStream = -1
  const system = mod.addFunction(() => 1, 'pi')
  const popen = mod.addFunction(
    (commandPointer: number, modePointer: number) => {
      const command = mod.UTF8ToString(commandPointer)
      const mode = mod.UTF8ToString(modePointer)
      if (!command.startsWith('locale -a') || mode !== 'r') return 0
      const path = mod.stringToUTF8OnStack('/pglite/locale-a')
      const modeValue = mod.stringToUTF8OnStack(mode)
      externalStream = mod._fopen(path, modeValue)
      return externalStream
    },
    'ppp',
  )
  const pclose = mod.addFunction((stream: number) => {
    if (stream !== externalStream) return -1
    const result = mod._fclose(stream)
    externalStream = -1
    return result
  }, 'pi')
  mod._pgl_set_system_fn(system)
  mod._pgl_set_popen_fn(popen)
  mod._pgl_set_pclose_fn(pclose)
}

function runtimeEnvironment(
  values: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const environment: Record<string, string> = {
    HOME: '/home/postgres',
    USER: 'postgres',
    LOGNAME: 'postgres',
    PGDATA,
    ICU_DATA: ICU_DATA_PATH,
  }
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) delete environment[name]
    else environment[name] = value
  }
  environment.PGDATA = PGDATA
  return environment
}

function mapPgdataArguments(argv: readonly string[]): string[] {
  const mapped = [...argv]
  let found = false
  for (let index = 0; index < mapped.length; index++) {
    const argument = mapped[index]
    if (argument === '-D' || argument === '--pgdata') {
      if (index + 1 >= mapped.length) return mapped
      mapped[++index] = PGDATA
      found = true
    } else if (argument.startsWith('--pgdata=')) {
      mapped[index] = `--pgdata=${PGDATA}`
      found = true
    } else if (argument.startsWith('-D') && argument.length > 2) {
      mapped[index] = `-D${PGDATA}`
      found = true
    }
  }
  if (!found) mapped.push('-D', PGDATA)
  return mapped
}

async function createClusterManifest(
  dataDir: string,
  argv: readonly string[],
  coreVersion: string,
  detectedEncoding: string | undefined,
): Promise<PGliteClusterManifestV1> {
  const pgVersion = (await readFile(join(dataDir, 'PG_VERSION'), 'utf8')).trim()
  const control = await readFile(join(dataDir, 'global', 'pg_control'))
  const manifest = createClusterManifestFromFiles(
    { pgVersion, control },
    {
      artifact: pgliteRuntimeIdentity.artifacts.classic,
      pgliteVersion: coreVersion,
      blockSize: pgliteRuntimeIdentity.blockSize,
      walBlockSize: pgliteRuntimeIdentity.walBlockSize,
      argv,
      detectedEncoding,
    },
  )
  const directory = join(dataDir, '.pglite')
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const target = join(directory, 'cluster.json')
  const temporary = join(directory, `.cluster.${randomUUID()}.tmp`)
  try {
    await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, {
      flag: 'wx',
      mode: 0o600,
    })
    await rename(temporary, target)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
  return manifest
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer
}
