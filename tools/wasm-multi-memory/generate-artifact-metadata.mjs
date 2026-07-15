#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(new URL('../..', import.meta.url).pathname)
const postgresRoot = resolve(root, 'postgres-pglite')
const release = resolve(root, 'packages/pglite/release')
const output = resolve(release, 'runtime-identity.json')
const toolsRelease = resolve(root, 'packages/pglite-tools/release')
const pglitePackage = JSON.parse(
  readFileSync(resolve(root, 'packages/pglite/package.json'), 'utf8'),
)

const pgConfig = readFileSync(
  resolve(postgresRoot, 'src/include/pg_config.h'),
  'utf8',
)
const catVersion = readFileSync(
  resolve(postgresRoot, 'src/include/catalog/catversion.h'),
  'utf8',
)
const postgresVersion = stringDefine(pgConfig, 'PG_VERSION')
const postgresVersionNum = numberDefine(pgConfig, 'PG_VERSION_NUM')
const catalogVersion = numberDefine(catVersion, 'CATALOG_VERSION_NO')
const blockSize = numberDefine(pgConfig, 'BLCKSZ')
const walBlockSize = numberDefine(pgConfig, 'XLOG_BLCKSZ')
const emscriptenOutput = execFileSync('emcc', ['--version'], {
  encoding: 'utf8',
})
const emscriptenVersion = requireMatch(
  emscriptenOutput,
  /\b(\d+\.\d+\.\d+)\b/,
  'Emscripten version',
)

const classic = identity('pglite.wasm', 'classic', 0)
const postmasterBytes = readFileSync(resolve(release, 'postmaster.wasm'))
const postmasterModule = new WebAssembly.Module(postmasterBytes)
const abiSections = WebAssembly.Module.customSections(
  postmasterModule,
  'pglite.multi-memory.abi',
)
if (abiSections.length !== 1) {
  throw new Error('postmaster.wasm must contain one multi-memory ABI section')
}
const transformerABI = JSON.parse(new TextDecoder().decode(abiSections[0]))
if (
  transformerABI.schema !== 1 ||
  transformerABI.pointerABI !== 'pglite-tagged-i32-v1'
) {
  throw new Error('postmaster.wasm has an unsupported transformer ABI')
}
const postmaster = identity(
  'postmaster.wasm',
  'multi-memory',
  transformerABI.schema,
)

writeFileSync(
  output,
  `${JSON.stringify(
    {
      schemaVersion: 1,
      pgliteVersion: pglitePackage.version,
      blockSize,
      walBlockSize,
      artifacts: { classic, postmaster },
    },
    null,
    2,
  )}\n`,
)
console.log(`wrote ${output}`)

const toolOutput = resolve(toolsRelease, 'runtime-identity.json')
writeFileSync(
  toolOutput,
  `${JSON.stringify(
    {
      schemaVersion: 1,
      pgliteAbiVersion: 1,
      postgresVersion,
      postgresVersionNum,
      catalogVersion,
      emscriptenVersion,
      artifacts: {
        pg_dump: toolIdentity('pg_dump.wasm'),
        pg_isready: toolIdentity('pg_isready.wasm'),
      },
    },
    null,
    2,
  )}\n`,
)
console.log(`wrote ${toolOutput}`)

function identity(file, memoryTopology, transformerAbiVersion) {
  const bytes = readFileSync(resolve(release, file))
  const artifactSha256 = createHash('sha256').update(bytes).digest('hex')
  return {
    postgresVersion,
    postgresVersionNum,
    catalogVersion,
    pgliteAbiVersion: 1,
    transformerAbiVersion,
    emscriptenVersion,
    memoryTopology,
    pointerWidth: 32,
    artifactSha256,
    buildId: artifactSha256,
  }
}

function toolIdentity(file) {
  const bytes = readFileSync(resolve(toolsRelease, file))
  const artifactSha256 = createHash('sha256').update(bytes).digest('hex')
  return { artifactSha256, buildId: artifactSha256 }
}

function stringDefine(source, name) {
  return requireMatch(
    source,
    new RegExp(`^#define\\s+${name}\\s+"([^"]+)"`, 'm'),
    name,
  )
}

function numberDefine(source, name) {
  return Number(
    requireMatch(
      source,
      new RegExp(`^#define\\s+${name}\\s+(\\d+)`, 'm'),
      name,
    ),
  )
}

function requireMatch(source, expression, description) {
  const match = expression.exec(source)
  if (!match) throw new Error(`cannot derive ${description}`)
  return match[1]
}
