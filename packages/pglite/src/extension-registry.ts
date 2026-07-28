import type { Extension } from './interface.js'
import {
  PGliteExtensionArtifactError,
  resolveArtifactUrl,
  targetsAreCompatible,
  validateArtifactDescriptor,
  type PGliteExtensionArtifactDescriptor,
  type PGliteExtensionArtifactLocator,
  type PGliteProcessConfigValue,
  type PGliteWasmTarget,
  type PGliteWasmTargetKey,
} from './extension-artifacts.js'
import { getExtensionArtifactOverride } from './extension.js'

export interface RegisteredExtension {
  readonly namespace: string
  readonly extension: Extension
}

export interface PreparedExtension extends RegisteredExtension {
  readonly descriptor: PGliteExtensionArtifactDescriptor
}

export interface PreparedExtensionSet {
  readonly extensions: readonly PreparedExtension[]
  readonly pgliteEnv: Readonly<Record<string, PGliteProcessConfigValue>>
  readonly requiredHostCapabilities: readonly string[]
  readonly requiredSharedPreloadLibraries: readonly string[]
  readonly fileOwners: ReadonlyMap<string, readonly string[]>
  readonly sideModuleOrder: readonly string[]
}

export interface PrepareExtensionSetOptions {
  readonly targetKey: PGliteWasmTargetKey
  readonly target: PGliteWasmTarget
  readonly locateExtensionArtifact?: PGliteExtensionArtifactLocator
  readonly reservedNamespaces?: ReadonlySet<string>
  readonly coreProcessConfigKeys?: ReadonlySet<string>
}

export function prepareExtensionSet(
  registered: Readonly<Record<string, Extension | URL>>,
  options: PrepareExtensionSetOptions,
): PreparedExtensionSet {
  const entries = Object.entries(registered).map(([namespace, extension]) => {
    if (extension instanceof URL) {
      throw new PGliteExtensionArtifactError(
        `legacy URL extension ${namespace} is wasm32-classic only and cannot be registered for ${options.targetKey}`,
        'unsupported-target',
      )
    }
    if (options.reservedNamespaces?.has(namespace)) {
      dependencyError(`extension namespace is reserved: ${namespace}`)
    }
    return { namespace, extension }
  })

  const byName = new Map<string, RegisteredExtension>()
  for (const entry of entries) {
    if (!entry.extension.name) dependencyError('extension name is required')
    const existing = byName.get(entry.extension.name)
    if (existing) {
      dependencyError(
        `extension ${entry.extension.name} is registered as both ${existing.namespace} and ${entry.namespace}`,
      )
    }
    byName.set(entry.extension.name, entry)
  }

  const ordered = topologicalSort(entries, byName)
  const prepared = ordered.map((entry) => {
    const original = entry.extension.backend?.artifacts[options.targetKey]
    if (!original) {
      throw new PGliteExtensionArtifactError(
        `extension ${entry.extension.name} does not declare ${options.targetKey}`,
        'unsupported-target',
      )
    }
    validateArtifactDescriptor(original)
    if (!targetsAreCompatible(options.target, original.target)) {
      throw new PGliteExtensionArtifactError(
        `extension ${entry.extension.name} has incompatible ${options.targetKey} ABI metadata`,
        'target-mismatch',
      )
    }
    const descriptor = resolveArtifactUrl(
      {
        extensionName: entry.extension.name,
        extensionVersion:
          entry.extension.version ?? original.manifest.extensionVersion,
        targetKey: options.targetKey,
        descriptor: original,
      },
      getExtensionArtifactOverride(entry.extension),
      options.locateExtensionArtifact,
    )
    if (descriptor.manifest.extensionName !== entry.extension.name) {
      dependencyError(
        `wrapper ${entry.extension.name} selected manifest for ${descriptor.manifest.extensionName}`,
      )
    }
    if (
      entry.extension.version !== undefined &&
      descriptor.manifest.extensionVersion !== entry.extension.version
    ) {
      dependencyError(
        `wrapper ${entry.extension.name}@${entry.extension.version} selected manifest version ${descriptor.manifest.extensionVersion}`,
      )
    }
    return { ...entry, descriptor }
  })

  validateArtifactDependencies(prepared)
  const fileOwners = collectFileOwners(prepared)
  const sideModuleOrder = orderSideModules(prepared)
  const process = mergeProcessConfiguration(
    prepared,
    options.coreProcessConfigKeys ?? new Set(),
  )
  return {
    extensions: prepared,
    pgliteEnv: process.pgliteEnv,
    requiredHostCapabilities: process.requiredHostCapabilities,
    requiredSharedPreloadLibraries: collectPreloads(prepared),
    fileOwners,
    sideModuleOrder,
  }
}

function topologicalSort(
  entries: readonly RegisteredExtension[],
  byName: ReadonlyMap<string, RegisteredExtension>,
): RegisteredExtension[] {
  const output: RegisteredExtension[] = []
  const visiting = new Set<string>()
  const visited = new Set<string>()

  const visit = (entry: RegisteredExtension, path: readonly string[]) => {
    const name = entry.extension.name
    if (visited.has(name)) return
    if (visiting.has(name)) {
      dependencyError(
        `extension dependency cycle: ${[...path, name].join(' -> ')}`,
      )
    }
    visiting.add(name)
    for (const dependency of entry.extension.dependsOn ?? []) {
      const required = byName.get(dependency)
      if (!required) {
        dependencyError(
          `extension ${name} depends on missing extension ${dependency}`,
        )
      }
      visit(required, [...path, name])
    }
    visiting.delete(name)
    visited.add(name)
    output.push(entry)
  }

  for (const entry of entries) visit(entry, [])
  return output
}

function validateArtifactDependencies(
  prepared: readonly PreparedExtension[],
): void {
  const byName = new Map(
    prepared.map((entry) => [entry.extension.name, entry] as const),
  )
  for (const entry of prepared) {
    for (const dependency of entry.descriptor.manifest.artifactDependencies) {
      const required = byName.get(dependency.extensionName)
      if (!required) {
        dependencyError(
          `artifact ${entry.extension.name} depends on missing artifact ${dependency.extensionName}`,
        )
      }
      if (
        !versionSatisfies(
          required.descriptor.manifest.extensionVersion,
          dependency.versionRange,
        )
      ) {
        dependencyError(
          `artifact ${entry.extension.name} requires ${dependency.extensionName}@${dependency.versionRange}, got ${required.descriptor.manifest.extensionVersion}`,
        )
      }
    }
  }
}

function collectFileOwners(
  prepared: readonly PreparedExtension[],
): ReadonlyMap<string, readonly string[]> {
  const files = new Map<
    string,
    { kind: string; sha256: string; owners: string[] }
  >()
  for (const entry of prepared) {
    for (const file of entry.descriptor.manifest.files) {
      const existing = files.get(file.path)
      if (!existing) {
        files.set(file.path, {
          kind: file.kind,
          sha256: file.sha256,
          owners: [entry.extension.name],
        })
      } else if (
        existing.kind === file.kind &&
        existing.sha256 === file.sha256
      ) {
        existing.owners.push(entry.extension.name)
      } else {
        dependencyError(
          `artifact file conflict at ${file.path}: ${existing.owners.join(', ')} and ${entry.extension.name}`,
        )
      }
    }
  }
  return new Map([...files].map(([path, value]) => [path, value.owners]))
}

function orderSideModules(
  prepared: readonly PreparedExtension[],
): readonly string[] {
  const modules = new Map<string, readonly string[]>()
  for (const entry of prepared) {
    for (const module of entry.descriptor.manifest.sideModules) {
      const id = `${entry.extension.name}:${module.logicalName}`
      if (modules.has(id))
        dependencyError(`duplicate side module identity: ${id}`)
      modules.set(id, module.loadAfter)
    }
  }
  const output: string[] = []
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (id: string, path: readonly string[]) => {
    if (visited.has(id)) return
    if (visiting.has(id)) {
      dependencyError(
        `side-module dependency cycle: ${[...path, id].join(' -> ')}`,
      )
    }
    const dependencies = modules.get(id)
    if (!dependencies) dependencyError(`missing side module dependency: ${id}`)
    visiting.add(id)
    for (const dependency of dependencies) visit(dependency, [...path, id])
    visiting.delete(id)
    visited.add(id)
    output.push(id)
  }
  for (const id of modules.keys()) visit(id, [])
  return output
}

function mergeProcessConfiguration(
  prepared: readonly PreparedExtension[],
  coreKeys: ReadonlySet<string>,
): {
  pgliteEnv: Readonly<Record<string, PGliteProcessConfigValue>>
  requiredHostCapabilities: readonly string[]
} {
  const pgliteEnv: Record<string, PGliteProcessConfigValue> = {}
  const owners = new Map<string, string>()
  const capabilities = new Set<string>()
  for (const entry of prepared) {
    const config = entry.descriptor.manifest.processConfig
    for (const capability of config.requiredHostCapabilities) {
      capabilities.add(capability)
    }
    for (const [key, value] of Object.entries(config.pgliteEnv)) {
      if (coreKeys.has(key)) {
        dependencyError(
          `extension ${entry.extension.name} sets core-owned key ${key}`,
        )
      }
      if (key in pgliteEnv && !configValuesEqual(pgliteEnv[key], value)) {
        dependencyError(
          `process configuration conflict for ${key}: ${owners.get(key)} and ${entry.extension.name}`,
        )
      }
      pgliteEnv[key] = value
      owners.set(key, entry.extension.name)
    }
  }
  return {
    pgliteEnv: Object.freeze(pgliteEnv),
    requiredHostCapabilities: [...capabilities],
  }
}

function collectPreloads(
  prepared: readonly PreparedExtension[],
): readonly string[] {
  const seen = new Set<string>()
  const output: string[] = []
  for (const entry of prepared) {
    for (const library of entry.descriptor.manifest
      .requiredSharedPreloadLibraries) {
      if (seen.has(library)) continue
      seen.add(library)
      output.push(library)
    }
  }
  return output
}

function configValuesEqual(
  left: PGliteProcessConfigValue,
  right: PGliteProcessConfigValue,
): boolean {
  if (typeof left !== 'object' || typeof right !== 'object') {
    return left === right
  }
  return left.artifactPath === right.artifactPath
}

function versionSatisfies(version: string, range: string): boolean {
  if (range === '*' || range === version) return true
  const parsed = parseVersion(version)
  if (!parsed) return false
  const operator = range[0]
  const required = parseVersion(
    operator === '^' || operator === '~' ? range.slice(1) : range,
  )
  if (!required) return false
  if (operator === '^') {
    const sameCompatibilityLine =
      required[0] > 0
        ? parsed[0] === required[0]
        : required[1] > 0
          ? parsed[0] === 0 && parsed[1] === required[1]
          : parsed[0] === 0 && parsed[1] === 0 && parsed[2] === required[2]
    return sameCompatibilityLine && compareVersion(parsed, required) >= 0
  }
  if (operator === '~') {
    return (
      parsed[0] === required[0] &&
      parsed[1] === required[1] &&
      compareVersion(parsed, required) >= 0
    )
  }
  return false
}

function parseVersion(value: string): [number, number, number] | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(value)
  if (!match) return undefined
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function compareVersion(
  left: readonly number[],
  right: readonly number[],
): number {
  for (let index = 0; index < 3; index++) {
    if (left[index] !== right[index]) return left[index] - right[index]
  }
  return 0
}

function dependencyError(message: string): never {
  throw new PGliteExtensionArtifactError(message, 'dependency-error')
}
