import {
  DEFAULT_PGLITE_ARTIFACT_LIMITS,
  PGliteExtensionArtifactError,
  targetsAreCompatible,
  validateArtifactDescriptor,
  type PGliteArtifactLimits,
  type PGliteExtensionArtifactDescriptor,
  type PGliteExtensionArtifactFile,
  type PGliteExtensionArtifactManifest,
} from './extension-artifacts.js'

export const PGLITE_EXTENSION_MANIFEST_PATH = '.pglite/extension-manifest.json'

export interface ValidatedExtensionArtifact {
  readonly descriptor: PGliteExtensionArtifactDescriptor
  readonly archive: Uint8Array
  readonly files: ReadonlyMap<string, Uint8Array>
}

export async function loadExtensionArtifact(
  descriptor: PGliteExtensionArtifactDescriptor,
  limits: PGliteArtifactLimits = DEFAULT_PGLITE_ARTIFACT_LIMITS,
): Promise<ValidatedExtensionArtifact> {
  validateArtifactDescriptor(descriptor)
  validateLimits(limits)
  if (descriptor.archiveBytes > limits.maximumArchiveBytes) {
    archiveError(
      `declared archive size ${descriptor.archiveBytes} exceeds limit ${limits.maximumArchiveBytes}`,
    )
  }
  const archive = await readUrl(descriptor.url, limits.maximumArchiveBytes)
  if (archive.byteLength !== descriptor.archiveBytes) {
    archiveError(
      `archive size mismatch: expected ${descriptor.archiveBytes}, got ${archive.byteLength}`,
    )
  }
  const digest = await sha256Hex(archive)
  if (digest !== descriptor.archiveSha256) {
    archiveError(
      `archive digest mismatch: expected ${descriptor.archiveSha256}, got ${digest}`,
    )
  }
  return validateExtensionArtifactBytes(descriptor, archive, limits)
}

export async function validateExtensionArtifactBytes(
  descriptor: PGliteExtensionArtifactDescriptor,
  archive: Uint8Array,
  limits: PGliteArtifactLimits = DEFAULT_PGLITE_ARTIFACT_LIMITS,
): Promise<ValidatedExtensionArtifact> {
  validateArtifactDescriptor(descriptor)
  validateLimits(limits)
  if (archive.byteLength > limits.maximumArchiveBytes) {
    archiveError(
      `archive size ${archive.byteLength} exceeds limit ${limits.maximumArchiveBytes}`,
    )
  }
  if (archive.byteLength !== descriptor.archiveBytes) {
    archiveError(
      `archive size mismatch: expected ${descriptor.archiveBytes}, got ${archive.byteLength}`,
    )
  }
  const archiveDigest = await sha256Hex(archive)
  if (archiveDigest !== descriptor.archiveSha256) {
    archiveError('archive digest mismatch')
  }
  const tar = await gunzipBounded(archive, limits.maximumExpandedBytes)
  const entries = parseTar(tar, limits)
  const manifestBytes = entries.files.get(PGLITE_EXTENSION_MANIFEST_PATH)
  if (!manifestBytes) archiveError('archive has no internal extension manifest')
  let internal: PGliteExtensionArtifactManifest
  try {
    internal = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes),
    )
  } catch (error) {
    archiveError(`invalid internal extension manifest: ${String(error)}`)
  }
  const canonical = new TextEncoder().encode(canonicalJson(internal))
  if (!bytesEqual(canonical, manifestBytes)) {
    archiveError('internal extension manifest is not canonically serialized')
  }
  const manifestDigest = await sha256Hex(canonical)
  if (manifestDigest !== descriptor.manifestSha256) {
    archiveError('internal manifest digest mismatch')
  }
  if (canonicalJson(internal) !== canonicalJson(descriptor.manifest)) {
    archiveError('internal manifest differs from generated descriptor manifest')
  }
  if (!targetsAreCompatible(descriptor.target, internal.target)) {
    archiveError('internal manifest target is incompatible with descriptor')
  }

  const declared = new Map(
    descriptor.manifest.files.map((file) => [file.path, file] as const),
  )
  const actualPaths = [...entries.files.keys()].filter(
    (path) => path !== PGLITE_EXTENSION_MANIFEST_PATH,
  )
  if (
    actualPaths.length !== declared.size ||
    actualPaths.some((path) => !declared.has(path))
  ) {
    archiveError('archive regular-file set does not equal its manifest')
  }
  const allowedDirectories = deriveDirectories([
    PGLITE_EXTENSION_MANIFEST_PATH,
    ...declared.keys(),
  ])
  for (const directory of entries.directories) {
    if (!allowedDirectories.has(directory)) {
      archiveError(`archive contains undeclared directory: ${directory}`)
    }
  }

  const files = new Map<string, Uint8Array>()
  for (const [path, declaration] of declared) {
    const bytes = entries.files.get(path)
    if (!bytes) archiveError(`archive is missing declared file: ${path}`)
    await validateFile(declaration, bytes)
    files.set(path, bytes)
  }
  await auditSideModules(descriptor, files)
  return { descriptor, archive, files }
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value))
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  let crypto = globalThis.crypto
  if (!crypto?.subtle) {
    crypto = (await import('node:crypto')).webcrypto as Crypto
  }
  const input = new Uint8Array(bytes).buffer
  const digest = await crypto.subtle.digest('SHA-256', input)
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
}

async function readUrl(url: URL, maximumBytes: number): Promise<Uint8Array> {
  if (url.protocol === 'file:') {
    const { readFile } = await import('node:fs/promises')
    const bytes = await readFile(url)
    if (bytes.byteLength > maximumBytes) {
      archiveError(`archive exceeds compressed-size limit ${maximumBytes}`)
    }
    return new Uint8Array(bytes)
  }
  const response = await fetch(url)
  if (!response.ok || !response.body) {
    archiveError(
      `could not read extension artifact ${url.href}: HTTP ${response.status}`,
    )
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    length += value.byteLength
    if (length > maximumBytes) {
      await reader.cancel()
      archiveError(`archive exceeds compressed-size limit ${maximumBytes}`)
    }
    chunks.push(value)
  }
  return concat(chunks, length)
}

async function gunzipBounded(
  archive: Uint8Array,
  maximumBytes: number,
): Promise<Uint8Array> {
  let stream: ReadableStream<Uint8Array>
  if (typeof DecompressionStream !== 'undefined') {
    stream = new Blob([new Uint8Array(archive).buffer])
      .stream()
      .pipeThrough(new DecompressionStream('gzip'))
  } else {
    const [{ Readable }, { createGunzip }] = await Promise.all([
      import('node:stream'),
      import('node:zlib'),
    ])
    stream = Readable.toWeb(
      Readable.from([archive]).pipe(createGunzip()),
    ) as ReadableStream<Uint8Array>
  }
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > maximumBytes) {
        await reader.cancel()
        archiveError(`archive exceeds expanded-size limit ${maximumBytes}`)
      }
      chunks.push(value)
    }
  } catch (error) {
    if (error instanceof PGliteExtensionArtifactError) throw error
    archiveError(`could not decompress extension artifact: ${String(error)}`)
  }
  return concat(chunks, length)
}

function parseTar(
  tar: Uint8Array,
  limits: PGliteArtifactLimits,
): { files: Map<string, Uint8Array>; directories: Set<string> } {
  const files = new Map<string, Uint8Array>()
  const directories = new Set<string>()
  let offset = 0
  let entries = 0
  let totalBytes = 0
  while (offset + 512 <= tar.byteLength) {
    const header = tar.subarray(offset, offset + 512)
    if (header.every((value) => value === 0)) {
      if (
        offset + 1024 <= tar.byteLength &&
        !tar.subarray(offset + 512, offset + 1024).every((value) => value === 0)
      ) {
        archiveError('tar archive has only one zero termination block')
      }
      const trailing = tar.subarray(Math.min(offset + 1024, tar.byteLength))
      if (!trailing.every((value) => value === 0)) {
        archiveError('tar archive has nonzero trailing bytes')
      }
      return { files, directories }
    }
    entries++
    if (entries > limits.maximumEntries) {
      archiveError(`archive exceeds entry-count limit ${limits.maximumEntries}`)
    }
    validateTarChecksum(header)
    const name = readTarString(header, 0, 100)
    const prefix = readTarString(header, 345, 155)
    const path = prefix ? `${prefix}/${name}` : name
    validateTarPath(path)
    const size = readTarOctal(header, 124, 12)
    if (size > limits.maximumFileBytes) {
      archiveError(`archive file ${path} exceeds per-file limit`)
    }
    const type = header[156]
    const dataStart = offset + 512
    const dataEnd = dataStart + size
    if (dataEnd > tar.byteLength) archiveError(`truncated tar entry: ${path}`)
    if (type === 0 || type === 48) {
      if (files.has(path) || directories.has(path)) {
        archiveError(`duplicate archive entry: ${path}`)
      }
      totalBytes += size
      if (totalBytes > limits.maximumExpandedBytes) {
        archiveError('archive regular files exceed expanded-size limit')
      }
      files.set(path, tar.slice(dataStart, dataEnd))
    } else if (type === 53) {
      const directory = path.endsWith('/') ? path.slice(0, -1) : path
      validateTarPath(directory)
      if (files.has(directory) || directories.has(directory)) {
        archiveError(`duplicate archive entry: ${directory}`)
      }
      directories.add(directory)
    } else {
      archiveError(
        `archive entry ${path} has forbidden tar type ${String.fromCharCode(type)}`,
      )
    }
    offset = dataStart + Math.ceil(size / 512) * 512
  }
  archiveError('tar archive has no two-block terminator')
}

async function validateFile(
  declaration: PGliteExtensionArtifactFile,
  bytes: Uint8Array,
): Promise<void> {
  if (bytes.byteLength !== declaration.size) {
    archiveError(`file size mismatch for ${declaration.path}`)
  }
  if ((await sha256Hex(bytes)) !== declaration.sha256) {
    archiveError(`file digest mismatch for ${declaration.path}`)
  }
}

async function auditSideModules(
  descriptor: PGliteExtensionArtifactDescriptor,
  files: ReadonlyMap<string, Uint8Array>,
): Promise<void> {
  for (const sideModule of descriptor.manifest.sideModules) {
    const bytes = files.get(sideModule.path)!
    let module: WebAssembly.Module
    try {
      module = new WebAssembly.Module(bytes)
    } catch (error) {
      archiveError(`invalid side module ${sideModule.path}: ${String(error)}`)
    }
    const memories = WebAssembly.Module.imports(module).filter(
      ({ kind }) => kind === 'memory',
    )
    if (descriptor.target.topology === 'classic') {
      if (memories.length > 1) {
        archiveError(
          `classic side module ${sideModule.path} imports multiple memories`,
        )
      }
    } else if (descriptor.target.topology === 'multi-memory') {
      const sections = WebAssembly.Module.customSections(
        module,
        'pglite.multi-memory.abi',
      )
      if (sections.length !== 1) {
        archiveError(
          `multi-memory side module ${sideModule.path} must contain one memory ABI section`,
        )
      }
      let abi: { pointerABI?: string }
      try {
        abi = JSON.parse(new TextDecoder().decode(sections[0]))
      } catch (error) {
        archiveError(
          `invalid memory ABI in ${sideModule.path}: ${String(error)}`,
        )
      }
      if (abi.pointerABI !== descriptor.target.memoryAbi) {
        archiveError(`incompatible memory ABI in ${sideModule.path}`)
      }
      if (memories.length !== 3) {
        archiveError(
          `multi-memory side module ${sideModule.path} must import three memories`,
        )
      }
    }
    const importsHash = await sha256Hex(
      new TextEncoder().encode(
        canonicalJson(
          WebAssembly.Module.imports(module).map(({ module, name, kind }) => ({
            module,
            name,
            kind,
          })),
        ),
      ),
    )
    if (importsHash !== sideModule.importsHash) {
      archiveError(`side-module import hash mismatch for ${sideModule.path}`)
    }
  }
}

function validateTarChecksum(header: Uint8Array): void {
  const expected = readTarOctal(header, 148, 8)
  let actual = 0
  for (let index = 0; index < header.length; index++) {
    actual += index >= 148 && index < 156 ? 32 : header[index]
  }
  if (actual !== expected) archiveError('invalid tar header checksum')
}

function readTarString(
  header: Uint8Array,
  offset: number,
  length: number,
): string {
  const bytes = header.subarray(offset, offset + length)
  const end = bytes.indexOf(0)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(
      end < 0 ? bytes : bytes.subarray(0, end),
    )
  } catch (error) {
    archiveError(`invalid UTF-8 tar path: ${String(error)}`)
  }
}

function readTarOctal(
  header: Uint8Array,
  offset: number,
  length: number,
): number {
  const value = readTarString(header, offset, length).trim().replace(/\0+$/, '')
  if (!/^[0-7]+$/.test(value)) archiveError('invalid tar numeric field')
  const parsed = Number.parseInt(value, 8)
  if (!Number.isSafeInteger(parsed))
    archiveError('tar numeric field is too large')
  return parsed
}

function validateTarPath(path: string): void {
  const normalized = path.endsWith('/') ? path.slice(0, -1) : path
  if (
    normalized.length === 0 ||
    normalized.startsWith('/') ||
    normalized.includes('\\') ||
    normalized.includes('\0') ||
    normalized
      .split('/')
      .some((part) => part === '' || part === '.' || part === '..')
  ) {
    archiveError(`non-canonical archive path: ${JSON.stringify(path)}`)
  }
}

function deriveDirectories(paths: readonly string[]): Set<string> {
  const directories = new Set<string>()
  for (const path of paths) {
    const parts = path.split('/')
    for (let index = 1; index < parts.length; index++) {
      directories.add(parts.slice(0, index).join('/'))
    }
  }
  return directories
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalValue(child)]),
    )
  }
  return value
}

function concat(chunks: readonly Uint8Array[], length: number): Uint8Array {
  const output = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false
  return left.every((value, index) => value === right[index])
}

function validateLimits(limits: PGliteArtifactLimits): void {
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      archiveError(`artifact limit ${name} must be a positive safe integer`)
    }
  }
}

function archiveError(message: string): never {
  throw new PGliteExtensionArtifactError(message, 'invalid-manifest')
}
