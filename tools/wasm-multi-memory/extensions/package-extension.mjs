#!/usr/bin/env node

import { createHash } from 'node:crypto'
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { gzipSync } from 'node:zlib'

const [configPath, inputPath, archivePath, descriptorPath] =
  process.argv.slice(2)
if (!descriptorPath) {
  throw new Error(
    'usage: pglite-package-extension CONFIG INPUT_DIR ARCHIVE DESCRIPTOR',
  )
}

const config = JSON.parse(readFileSync(configPath, 'utf8'))
const input = resolve(inputPath)
const archiveOutput = resolve(archivePath)
const descriptorOutput = resolve(descriptorPath)
const files = walk(input).map((path) => {
  const bytes = new Uint8Array(readFileSync(join(input, ...path.split('/'))))
  return {
    path,
    bytes,
    size: bytes.byteLength,
    sha256: sha256(bytes),
    kind: fileKind(path),
  }
})
const byPath = new Map(files.map((file) => [file.path, file]))
const configuredModules = new Map(
  (config.sideModules ?? []).map((module) => [module.path, module]),
)
for (const configuredPath of configuredModules.keys()) {
  if (!byPath.has(configuredPath)) {
    throw new Error(`configured side module does not exist: ${configuredPath}`)
  }
}
const sideModuleFiles =
  config.sideModules === undefined
    ? files.filter(({ kind }) => kind === 'side-module')
    : [...configuredModules.keys()].map((path) => byPath.get(path))
const sideModules = sideModuleFiles
  .map((file) => {
    const configured = configuredModules.get(file.path) ?? {}
    const module = new WebAssembly.Module(file.bytes)
    return {
      logicalName:
        configured.logicalName ??
        file.path.split('/').pop().replace(/\.so$/, ''),
      path: file.path,
      sha256: file.sha256,
      wasmAbiSection:
        config.target.topology === 'multi-memory'
          ? 'pglite.multi-memory.abi'
          : 'classic',
      importsHash: sha256(
        new TextEncoder().encode(
          canonicalJson(
            WebAssembly.Module.imports(module).map(
              ({ module, name, kind }) => ({
                module,
                name,
                kind,
              }),
            ),
          ),
        ),
      ),
      loadAfter: configured.loadAfter ?? [],
    }
  })

const manifest = {
  formatVersion: 1,
  extensionName: requiredString(config.extensionName, 'extensionName'),
  extensionVersion: requiredString(config.extensionVersion, 'extensionVersion'),
  target: config.target,
  artifactDependencies: config.artifactDependencies ?? [],
  postgresExtensions:
    config.postgresExtensions ?? inferPostgresExtensions(files),
  files: files.map(({ path, size, sha256, kind }) => ({
    path,
    size,
    sha256,
    kind,
  })),
  sideModules,
  requiredSharedPreloadLibraries: config.requiredSharedPreloadLibraries ?? [],
  processConfig: config.processConfig ?? {
    pgliteEnv: {},
    requiredHostCapabilities: [],
  },
  capabilities: config.capabilities ?? {
    directSharedMemory: config.target.topology !== 'classic',
    backgroundWorkers: false,
    parallelWorkers: false,
  },
}

const manifestBytes = new TextEncoder().encode(canonicalJson(manifest))
const archiveEntries = [
  {
    path: '.pglite/extension-manifest.json',
    bytes: manifestBytes,
  },
  ...files,
].sort((left, right) =>
  Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)),
)
const tarBytes = makeTar(archiveEntries)
const archiveBytes = new Uint8Array(gzipSync(tarBytes, { level: 9, mtime: 0 }))
const descriptor = {
  schemaVersion: 1,
  targetKey: targetKey(config.target),
  target: config.target,
  archiveBytes: archiveBytes.byteLength,
  archiveSha256: sha256(archiveBytes),
  manifestSha256: sha256(manifestBytes),
  extensionManifest: manifest,
}

mkdirSync(dirname(archiveOutput), { recursive: true })
mkdirSync(dirname(descriptorOutput), { recursive: true })
writeFileSync(archiveOutput, archiveBytes)
writeFileSync(descriptorOutput, `${JSON.stringify(descriptor, null, 2)}\n`)
console.log(
  JSON.stringify({
    archive: archiveOutput,
    descriptor: descriptorOutput,
    targetKey: descriptor.targetKey,
    archiveSha256: descriptor.archiveSha256,
    manifestSha256: descriptor.manifestSha256,
  }),
)

function walk(root) {
  const output = []
  const visit = (directory) => {
    const names = readdirSync(directory).sort((left, right) =>
      Buffer.compare(Buffer.from(left), Buffer.from(right)),
    )
    for (const name of names) {
      const absolute = join(directory, name)
      const stat = lstatSync(absolute)
      if (stat.isSymbolicLink()) {
        const resolved = realpathSync(absolute)
        const relativeTarget = relative(root, resolved)
        if (
          relativeTarget.startsWith(`..${sep}`) ||
          relativeTarget === '..' ||
          !lstatSync(resolved).isFile()
        ) {
          throw new Error(
            `extension input contains an unsafe symbolic link: ${absolute}`,
          )
        }
        const path = relative(root, absolute).split(sep).join('/')
        validatePath(path)
        output.push(path)
      } else if (stat.isDirectory()) {
        visit(absolute)
      } else if (stat.isFile()) {
        const path = relative(root, absolute).split(sep).join('/')
        validatePath(path)
        output.push(path)
      } else {
        throw new Error(`extension input is not a regular file: ${absolute}`)
      }
    }
  }
  visit(root)
  return output
}

function inferPostgresExtensions(inputFiles) {
  return inputFiles
    .filter(({ path }) => path.endsWith('.control'))
    .map(({ path, bytes }) => {
      const name = path
        .split('/')
        .pop()
        .replace(/\.control$/, '')
      const text = new TextDecoder().decode(bytes)
      const requires = /^requires\s*=\s*['"]([^'"]*)['"]/m.exec(text)?.[1]
      return {
        name,
        requires: requires
          ? requires
              .split(',')
              .map((value) => value.trim())
              .filter(Boolean)
          : [],
      }
    })
}

function fileKind(path) {
  if (path.endsWith('.so')) return 'side-module'
  if (path.endsWith('.sql')) return 'sql'
  if (path.endsWith('.control')) return 'control'
  if (path.includes('/share/') || path.startsWith('share/')) return 'data'
  return 'other'
}

function targetKey(target) {
  if (
    (target.pointerWidth !== 32 && target.pointerWidth !== 64) ||
    target.memoryAddressWidth !== target.pointerWidth ||
    !['classic', 'faceted', 'multi-memory'].includes(target.topology)
  ) {
    throw new Error('invalid target in extension package configuration')
  }
  return `wasm${target.pointerWidth}-${target.topology}`
}

function makeTar(entries) {
  const chunks = []
  for (const { path, bytes } of entries) {
    validatePath(path)
    const { name, prefix } = splitUstarPath(path)
    const header = new Uint8Array(512)
    writeString(header, 0, 100, name)
    writeOctal(header, 100, 8, 0o644)
    writeOctal(header, 108, 8, 0)
    writeOctal(header, 116, 8, 0)
    writeOctal(header, 124, 12, bytes.byteLength)
    writeOctal(header, 136, 12, 0)
    header.fill(32, 148, 156)
    header[156] = 48
    writeString(header, 257, 6, 'ustar')
    writeString(header, 263, 2, '00')
    writeString(header, 265, 32, 'root')
    writeString(header, 297, 32, 'root')
    if (prefix) writeString(header, 345, 155, prefix)
    let checksum = 0
    for (const value of header) checksum += value
    writeOctal(header, 148, 8, checksum)
    chunks.push(header, bytes)
    const padding = (512 - (bytes.byteLength % 512)) % 512
    if (padding) chunks.push(new Uint8Array(padding))
  }
  chunks.push(new Uint8Array(1024))
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)))
}

function splitUstarPath(path) {
  if (Buffer.byteLength(path) <= 100) return { name: path, prefix: '' }
  for (
    let index = path.lastIndexOf('/');
    index > 0;
    index = path.lastIndexOf('/', index - 1)
  ) {
    const prefix = path.slice(0, index)
    const name = path.slice(index + 1)
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100) {
      return { name, prefix }
    }
  }
  throw new Error(`path does not fit ustar name/prefix fields: ${path}`)
}

function writeString(target, offset, length, value) {
  const bytes = new TextEncoder().encode(value)
  if (bytes.byteLength > length)
    throw new Error(`tar field is too long: ${value}`)
  target.set(bytes, offset)
}

function writeOctal(target, offset, length, value) {
  const text = value.toString(8).padStart(length - 2, '0') + '\0 '
  target.set(new TextEncoder().encode(text), offset)
}

function validatePath(path) {
  if (
    !path ||
    path.startsWith('/') ||
    path.includes('\\') ||
    path.includes('\0') ||
    path.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    throw new Error(`non-canonical extension path: ${JSON.stringify(path)}`)
  }
}

function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value))
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalValue(child)]),
    )
  }
  return value
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function requiredString(value, name) {
  if (typeof value !== 'string' || !value)
    throw new Error(`${name} is required`)
  return value
}
