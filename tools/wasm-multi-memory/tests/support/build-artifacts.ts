import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { promisify } from 'node:util'
import {
  artifact,
  fixture,
  outputDirectory,
  runtimeCapability,
} from './artifacts.js'
import { generateOpcodeFixture } from './generate-fixture.js'

const execute = promisify(execFile)

async function run(command: string, args: string[]): Promise<void> {
  await execute(command, args, { maxBuffer: 16 * 1024 * 1024 })
}

async function sha256(path: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex')
}

async function transform(
  input: string,
  output: string,
  report: string,
  extra: string[] = [],
): Promise<void> {
  await run('pglite-wasm-multi-memory', [
    input,
    '-o',
    output,
    '--report',
    report,
    '--global-initial-pages',
    '2',
    '--global-maximum-pages',
    '16',
    ...extra,
  ])
}

export default async function buildArtifacts(): Promise<void> {
  await rm(outputDirectory, { recursive: true, force: true })
  await mkdir(outputDirectory, { recursive: true })

  generateOpcodeFixture(artifact('opcodes.wat'))
  await run('wasm-opt', [
    artifact('opcodes.wat'),
    '-o',
    artifact('opcodes.wasm'),
    '--all-features',
    '--emit-target-features',
    '-g',
    `--output-source-map=${artifact('opcodes.wasm.map')}`,
    '--output-source-map-url=opcodes.wasm.map',
  ])

  const inputHash = await sha256(artifact('opcodes.wasm'))
  for (const suffix of ['', '.repeat']) {
    await transform(
      artifact('opcodes.wasm'),
      artifact(`opcodes.multi${suffix}.wasm`),
      artifact(`report${suffix}.json`),
      [
        '--input-source-map',
        artifact('opcodes.wasm.map'),
        '--output-source-map',
        artifact(`opcodes.multi${suffix}.wasm.map`),
        '--output-source-map-url',
        'opcodes.multi.wasm.map',
        '--input-sha256',
        inputHash,
      ],
    )
  }

  await run('wasm-opt', [
    artifact('opcodes.multi.wasm'),
    '--all-features',
    '--vacuum',
    '-o',
    artifact('validated.wasm'),
  ])

  await run('emcc', [
    fixture('source-map.c'),
    '-O0',
    '-gsource-map',
    '--no-entry',
    '-sSTANDALONE_WASM=1',
    '-sIMPORTED_MEMORY=1',
    '-sALLOW_MEMORY_GROWTH=1',
    '-sINITIAL_MEMORY=131072',
    '-sMAXIMUM_MEMORY=1048576',
    '-Wl,--export=source_map_read',
    '-Wl,--export=source_map_write',
    '-o',
    artifact('source-map.wasm'),
  ])
  await transform(
    artifact('source-map.wasm'),
    artifact('source-map.multi.wasm'),
    artifact('source-map.report.json'),
    [
      '--input-source-map',
      artifact('source-map.wasm.map'),
      '--output-source-map',
      artifact('source-map.multi.wasm.map'),
      '--output-source-map-url',
      'source-map.multi.wasm.map',
      '--input-sha256',
      await sha256(artifact('source-map.wasm')),
    ],
  )

  await transform(
    artifact('opcodes.wasm'),
    artifact('opcodes.inline.wasm'),
    artifact('report.inline.json'),
    ['--inline-private-fast-path'],
  )

  await run('wasm-opt', [
    fixture('provenance.wat'),
    '-o',
    artifact('provenance.wasm'),
    '--all-features',
    '--emit-target-features',
  ])
  await transform(
    artifact('provenance.wasm'),
    artifact('provenance.multi.wasm'),
    artifact('provenance.report.json'),
    [
      '--provenance',
      '--private-return-export',
      'palloc',
      '--private-identity-export',
      'pgl_private_pointer',
    ],
  )

  for (const name of [
    'unimported-memory',
    'oversized-memory',
    'multiple-input-memories',
  ]) {
    await run('wasm-opt', [
      fixture('invalid', `${name}.wat`),
      '-o',
      artifact(`${name}.wasm`),
      '--all-features',
      '--emit-target-features',
    ])
  }

  await run('wasm-opt', [
    runtimeCapability('capability.wat'),
    '-o',
    artifact('capability.wasm'),
    '--all-features',
    '--emit-target-features',
  ])
}
