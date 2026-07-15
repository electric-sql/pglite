export const PGLITE_EXTENSION_ARTIFACT_FORMAT_VERSION = 1
export const PGLITE_EXTENSION_ABI = 'pglite-extension-abi-v1'
export const PGLITE_CLASSIC_MEMORY_ABI = 'pglite-classic-memory-v1'
export const PGLITE_MULTI_MEMORY_ABI = 'pglite-tagged-i32-v1'
export const PGLITE_HOST_ABI = 'pglite-host-abi-v1'

export type PGlitePointerWidth = 32 | 64

export type PGliteMemoryTopology = 'classic' | 'faceted' | 'multi-memory'

export const PGLITE_WASM_TARGET_KEYS = [
  'wasm32-classic',
  'wasm32-faceted',
  'wasm32-multi-memory',
  'wasm64-classic',
  'wasm64-faceted',
  'wasm64-multi-memory',
] as const

export type PGliteWasmTargetKey = (typeof PGLITE_WASM_TARGET_KEYS)[number]

export interface PGliteWasmTarget {
  readonly pointerWidth: PGlitePointerWidth
  readonly memoryAddressWidth: PGlitePointerWidth
  readonly topology: PGliteMemoryTopology
  readonly postgresMajor: number
  readonly postgresAbi: string
  readonly pgliteExtensionAbi: string
  readonly memoryAbi: string
  readonly hostAbi: string
}

export const PGLITE_RELEASE_PROFILES = {
  'wasm32-initial': ['wasm32-classic', 'wasm32-multi-memory'] as const,
  'wasm32-complete': [
    'wasm32-classic',
    'wasm32-faceted',
    'wasm32-multi-memory',
  ] as const,
  full: PGLITE_WASM_TARGET_KEYS,
} as const

export type PGliteReleaseProfile = keyof typeof PGLITE_RELEASE_PROFILES

export type PGliteExtensionArtifactFileKind =
  | 'side-module'
  | 'sql'
  | 'control'
  | 'data'
  | 'other'

export interface PGliteExtensionArtifactFile {
  readonly path: string
  readonly size: number
  readonly sha256: string
  readonly kind: PGliteExtensionArtifactFileKind
}

export interface PGliteExtensionSideModule {
  readonly logicalName: string
  readonly path: string
  readonly sha256: string
  readonly wasmAbiSection: string
  readonly importsHash: string
  readonly loadAfter: readonly string[]
}

export interface PGliteExtensionArtifactDependency {
  readonly extensionName: string
  readonly versionRange: string
}

export interface PGlitePostgresExtensionDeclaration {
  readonly name: string
  readonly requires: readonly string[]
}

export type PGliteProcessConfigValue =
  | string
  | number
  | boolean
  | { readonly artifactPath: string }

export interface PGliteExtensionProcessConfig {
  readonly pgliteEnv: Readonly<Record<string, PGliteProcessConfigValue>>
  readonly requiredHostCapabilities: readonly string[]
}

export interface PGliteExtensionCapabilities {
  readonly directSharedMemory: boolean
  readonly backgroundWorkers: boolean
  readonly parallelWorkers: boolean
}

export interface PGliteExtensionArtifactManifest {
  readonly formatVersion: number
  readonly extensionName: string
  readonly extensionVersion: string
  readonly target: PGliteWasmTarget
  readonly artifactDependencies: readonly PGliteExtensionArtifactDependency[]
  readonly postgresExtensions: readonly PGlitePostgresExtensionDeclaration[]
  readonly files: readonly PGliteExtensionArtifactFile[]
  readonly sideModules: readonly PGliteExtensionSideModule[]
  readonly requiredSharedPreloadLibraries: readonly string[]
  readonly processConfig: PGliteExtensionProcessConfig
  readonly capabilities: PGliteExtensionCapabilities
}

export interface PGliteExtensionArtifactDescriptor {
  readonly targetKey: PGliteWasmTargetKey
  readonly target: PGliteWasmTarget
  readonly url: URL
  readonly archiveBytes: number
  readonly archiveSha256: string
  readonly manifestSha256: string
  readonly manifest: PGliteExtensionArtifactManifest
}

export interface PGliteExtensionBackendDescriptor {
  /** Named completeness profile asserted by generated release tooling. */
  readonly releaseProfile?: PGliteReleaseProfile
  /** Exact generated inventory; useful even for an unnamed partial map. */
  readonly targetKeys?: readonly PGliteWasmTargetKey[]
  readonly artifacts: Partial<
    Record<PGliteWasmTargetKey, PGliteExtensionArtifactDescriptor>
  >
}

export interface PGliteExtensionArtifactRequest {
  readonly extensionName: string
  readonly extensionVersion: string
  readonly targetKey: PGliteWasmTargetKey
  readonly descriptor: PGliteExtensionArtifactDescriptor
}

export type PGliteExtensionArtifactLocator = (
  request: PGliteExtensionArtifactRequest,
) => URL

export interface PGliteConfiguredArtifactOverride {
  readonly artifact?: PGliteExtensionArtifactDescriptor
  readonly locateArtifact?: PGliteExtensionArtifactLocator
}

export interface PGliteArtifactLimits {
  readonly maximumArchiveBytes: number
  readonly maximumExpandedBytes: number
  readonly maximumEntries: number
  readonly maximumFileBytes: number
}

export const DEFAULT_PGLITE_ARTIFACT_LIMITS: PGliteArtifactLimits = {
  maximumArchiveBytes: 64 * 1024 * 1024,
  maximumExpandedBytes: 256 * 1024 * 1024,
  maximumEntries: 4096,
  maximumFileBytes: 128 * 1024 * 1024,
}

export type RawWasmPointer<W extends PGlitePointerWidth> = W extends 32
  ? number
  : bigint

export interface DecodedWasmAddress {
  readonly memory: 'private' | 'global' | 'scoped'
  readonly offset: number
}

export interface WasmHostAbi<W extends PGlitePointerWidth> {
  readonly pointerWidth: W
  readonly maximumHostOffset: bigint
  decodeAddress(
    pointer: RawWasmPointer<W>,
    accessLength?: number,
  ): DecodedWasmAddress
  add(pointer: RawWasmPointer<W>, byteOffset: number): RawWasmPointer<W>
  readPointer(view: DataView, byteOffset: number): RawWasmPointer<W>
  writePointer(
    view: DataView,
    byteOffset: number,
    pointer: RawWasmPointer<W>,
  ): void
}

export interface PGliteTargetSelectionCandidate {
  readonly targetKey: PGliteWasmTargetKey
  readonly target: PGliteWasmTarget
}

export class PGliteExtensionArtifactError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'invalid-descriptor'
      | 'invalid-manifest'
      | 'unsupported-target'
      | 'target-mismatch'
      | 'dependency-error'
      | 'artifact-resolution-error',
  ) {
    super(message)
    this.name = 'PGliteExtensionArtifactError'
  }
}

export function targetKeyFor(target: PGliteWasmTarget): PGliteWasmTargetKey {
  return `wasm${target.pointerWidth}-${target.topology}` as PGliteWasmTargetKey
}

export function targetsAreCompatible(
  expected: PGliteWasmTarget,
  actual: PGliteWasmTarget,
): boolean {
  return (
    expected.pointerWidth === actual.pointerWidth &&
    expected.memoryAddressWidth === actual.memoryAddressWidth &&
    expected.topology === actual.topology &&
    expected.postgresMajor === actual.postgresMajor &&
    expected.postgresAbi === actual.postgresAbi &&
    expected.pgliteExtensionAbi === actual.pgliteExtensionAbi &&
    expected.memoryAbi === actual.memoryAbi &&
    expected.hostAbi === actual.hostAbi
  )
}

export function validateArtifactDescriptor(
  descriptor: PGliteExtensionArtifactDescriptor,
): void {
  if (!(descriptor.url instanceof URL)) {
    invalidDescriptor('artifact URL must be a URL')
  }
  if (
    !Number.isSafeInteger(descriptor.archiveBytes) ||
    descriptor.archiveBytes < 0
  ) {
    invalidDescriptor('archiveBytes must be a non-negative safe integer')
  }
  requireSha256(descriptor.archiveSha256, 'archiveSha256', invalidDescriptor)
  requireSha256(descriptor.manifestSha256, 'manifestSha256', invalidDescriptor)
  if (!PGLITE_WASM_TARGET_KEYS.includes(descriptor.targetKey)) {
    invalidDescriptor(`unknown target key: ${descriptor.targetKey}`)
  }
  if (targetKeyFor(descriptor.target) !== descriptor.targetKey) {
    invalidDescriptor(
      `target key ${descriptor.targetKey} does not match structured target`,
    )
  }
  if (!targetsAreCompatible(descriptor.target, descriptor.manifest.target)) {
    invalidDescriptor('descriptor target does not match manifest target')
  }
  validateArtifactManifest(descriptor.manifest)
}

export function validateArtifactManifest(
  manifest: PGliteExtensionArtifactManifest,
): void {
  if (manifest.formatVersion !== PGLITE_EXTENSION_ARTIFACT_FORMAT_VERSION) {
    invalidManifest(
      `unsupported format version ${manifest.formatVersion}; expected ${PGLITE_EXTENSION_ARTIFACT_FORMAT_VERSION}`,
    )
  }
  requireNonEmpty(manifest.extensionName, 'extensionName')
  requireNonEmpty(manifest.extensionVersion, 'extensionVersion')
  validateTarget(manifest.target)

  const paths = new Set<string>()
  for (const file of manifest.files) {
    validateArtifactPath(file.path)
    if (paths.has(file.path))
      invalidManifest(`duplicate file path: ${file.path}`)
    paths.add(file.path)
    if (!Number.isSafeInteger(file.size) || file.size < 0) {
      invalidManifest(`invalid size for ${file.path}`)
    }
    requireSha256(file.sha256, `files[${file.path}].sha256`, invalidManifest)
  }

  const logicalNames = new Set<string>()
  for (const sideModule of manifest.sideModules) {
    requireNonEmpty(sideModule.logicalName, 'side module logicalName')
    if (logicalNames.has(sideModule.logicalName)) {
      invalidManifest(`duplicate side module: ${sideModule.logicalName}`)
    }
    logicalNames.add(sideModule.logicalName)
    if (!paths.has(sideModule.path)) {
      invalidManifest(
        `side module ${sideModule.logicalName} has undeclared path ${sideModule.path}`,
      )
    }
    const file = manifest.files.find(({ path }) => path === sideModule.path)
    if (file?.kind !== 'side-module') {
      invalidManifest(`${sideModule.path} is not declared as a side-module`)
    }
    requireSha256(
      sideModule.sha256,
      `sideModules[${sideModule.logicalName}].sha256`,
      invalidManifest,
    )
    if (file.sha256 !== sideModule.sha256) {
      invalidManifest(`side module hash differs for ${sideModule.path}`)
    }
  }

  for (const sideModule of manifest.sideModules) {
    for (const dependency of sideModule.loadAfter) {
      const [extensionName, logicalName, extra] = dependency.split(':')
      if (!extensionName || !logicalName || extra !== undefined) {
        invalidManifest(`invalid side-module dependency: ${dependency}`)
      }
      if (
        extensionName === manifest.extensionName &&
        !logicalNames.has(logicalName)
      ) {
        invalidManifest(`missing side-module dependency: ${dependency}`)
      }
    }
  }

  const ownedPaths = new Set(paths)
  for (const path of paths) {
    const parts = path.split('/')
    for (let index = 1; index < parts.length; index++) {
      ownedPaths.add(parts.slice(0, index).join('/'))
    }
  }
  for (const [key, value] of Object.entries(manifest.processConfig.pgliteEnv)) {
    requireNonEmpty(key, 'process configuration key')
    if (typeof value === 'object') {
      if (value === null || !('artifactPath' in value)) {
        invalidManifest(`invalid process configuration value for ${key}`)
      }
      validateArtifactPath(value.artifactPath)
      if (!ownedPaths.has(value.artifactPath)) {
        invalidManifest(
          `process configuration path is not owned by the artifact: ${value.artifactPath}`,
        )
      }
    }
  }
}

export function selectExactTarget(
  candidates: readonly PGliteTargetSelectionCandidate[],
  extensionBackends: readonly PGliteExtensionBackendDescriptor[],
): PGliteTargetSelectionCandidate {
  for (const candidate of candidates) {
    const supported = extensionBackends.every(
      ({ artifacts }) => artifacts[candidate.targetKey] !== undefined,
    )
    if (!supported) continue
    for (const backend of extensionBackends) {
      const descriptor = backend.artifacts[candidate.targetKey]!
      validateArtifactDescriptor(descriptor)
      if (!targetsAreCompatible(candidate.target, descriptor.target)) {
        throw new PGliteExtensionArtifactError(
          `extension target ${candidate.targetKey} has incompatible ABI metadata`,
          'target-mismatch',
        )
      }
    }
    return candidate
  }
  throw new PGliteExtensionArtifactError(
    `registered extensions do not support any available target: ${candidates
      .map(({ targetKey }) => targetKey)
      .join(', ')}`,
    'unsupported-target',
  )
}

export function resolveArtifactUrl(
  request: PGliteExtensionArtifactRequest,
  configured: PGliteConfiguredArtifactOverride | undefined,
  runtimeLocator: PGliteExtensionArtifactLocator | undefined,
): PGliteExtensionArtifactDescriptor {
  const replacement = configured?.artifact
  if (replacement) {
    validateArtifactDescriptor(replacement)
    if (
      replacement.targetKey !== request.targetKey ||
      !targetsAreCompatible(replacement.target, request.descriptor.target)
    ) {
      throw new PGliteExtensionArtifactError(
        `configured artifact for ${request.extensionName} does not match ${request.targetKey}`,
        'target-mismatch',
      )
    }
    return replacement
  }
  const url =
    configured?.locateArtifact?.(request) ??
    runtimeLocator?.(request) ??
    request.descriptor.url
  if (!(url instanceof URL)) {
    throw new PGliteExtensionArtifactError(
      `artifact locator for ${request.extensionName} did not return a URL`,
      'artifact-resolution-error',
    )
  }
  return { ...request.descriptor, url }
}

export function releaseProfileIsComplete(
  profile: PGliteReleaseProfile,
  artifacts: Partial<
    Record<PGliteWasmTargetKey, PGliteExtensionArtifactDescriptor>
  >,
): boolean {
  return PGLITE_RELEASE_PROFILES[profile].every(
    (targetKey) => artifacts[targetKey] !== undefined,
  )
}

export function assertExtensionHostCapabilities(
  required: readonly string[],
  available: ReadonlySet<string>,
): void {
  const missing = required.filter((capability) => !available.has(capability))
  if (missing.length > 0) {
    throw new PGliteExtensionArtifactError(
      `extension host capabilities are unavailable: ${missing.join(', ')}`,
      'unsupported-target',
    )
  }
}

function validateTarget(target: PGliteWasmTarget): void {
  if (target.pointerWidth !== 32 && target.pointerWidth !== 64) {
    invalidManifest(`invalid pointer width: ${target.pointerWidth}`)
  }
  if (target.memoryAddressWidth !== target.pointerWidth) {
    invalidManifest(
      'public target pointerWidth and memoryAddressWidth must match',
    )
  }
  if (!['classic', 'faceted', 'multi-memory'].includes(target.topology)) {
    invalidManifest(`invalid topology: ${target.topology}`)
  }
  if (!Number.isSafeInteger(target.postgresMajor) || target.postgresMajor < 1) {
    invalidManifest(`invalid PostgreSQL major: ${target.postgresMajor}`)
  }
  requireNonEmpty(target.postgresAbi, 'postgresAbi')
  requireNonEmpty(target.pgliteExtensionAbi, 'pgliteExtensionAbi')
  requireNonEmpty(target.memoryAbi, 'memoryAbi')
  requireNonEmpty(target.hostAbi, 'hostAbi')
}

function validateArtifactPath(path: string): void {
  if (
    path.length === 0 ||
    path.startsWith('/') ||
    path.includes('\\') ||
    path.includes('\0') ||
    path.split('/').some((part) => part === '' || part === '.' || part === '..')
  ) {
    invalidManifest(`non-canonical artifact path: ${JSON.stringify(path)}`)
  }
}

function requireNonEmpty(value: string, field: string): void {
  if (typeof value !== 'string' || value.length === 0) {
    invalidManifest(`${field} must be a non-empty string`)
  }
}

function requireSha256(
  value: string,
  field: string,
  fail: (message: string) => never,
): void {
  if (!/^[0-9a-f]{64}$/.test(value)) {
    fail(`${field} must be a lowercase SHA-256 digest`)
  }
}

function invalidDescriptor(message: string): never {
  throw new PGliteExtensionArtifactError(message, 'invalid-descriptor')
}

function invalidManifest(message: string): never {
  throw new PGliteExtensionArtifactError(message, 'invalid-manifest')
}
