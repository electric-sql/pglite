# PGlite Multi-Runtime Extension Artifact Design

Status: Milestone A (`wasm32-initial`) implemented; later milestones deferred
Initial environments: Node.js and browser runtimes supported by the corresponding PGlite runtime
Artifact strategy: six prebuilt backend-extension variants behind one TypeScript wrapper
Initial release scope: wasm32 classic and wasm32 multi-memory
Client-side Wasm rewriting: explicitly out of scope
Last updated: 2026-07-15

## 1. Summary

PGlite is expected to have three WebAssembly memory topologies:

1. **classic**: the existing single-user runtime with unshared linear memory and no `SharedArrayBuffer` requirement;
2. **faceted**: the multi-session Worker runtime using a single shared linear memory with logically distinct memory facets;
3. **multi-memory**: the multi-session Worker runtime using distinct Wasm memories for private, cluster-global, and scoped state.

PGlite also intends to make both wasm32 and wasm64 builds available. A native PostgreSQL extension is coupled to both the C pointer-width ABI and the Wasm memory topology. The complete target matrix is therefore six variants:

| Target key            | Pointer width | Memory topology | SAB required | Multiple memories required |
| --------------------- | ------------- | --------------- | ------------ | -------------------------- |
| `wasm32-classic`      | 32            | classic         | no           | no                         |
| `wasm32-faceted`      | 32            | faceted         | yes          | no                         |
| `wasm32-multi-memory` | 32            | multi-memory    | yes          | yes                        |
| `wasm64-classic`      | 64            | classic         | no           | no                         |
| `wasm64-faceted`      | 64            | faceted         | yes          | no                         |
| `wasm64-multi-memory` | 64            | multi-memory    | yes          | yes                        |

In this document, **wasm64 means full end-to-end WebAssembly memory64**: the C ABI has 64-bit pointers and the Wasm memories are i64-addressed. Emscripten's compatibility mode that compiles a 64-bit C ABI and then lowers the binary to wasm32 is not one of these six targets. If PGlite ever ships that mode, it requires a distinct target key and ABI identity.

This design accepts six prebuilt backend artifacts per native extension. It does not transform, specialize, or optimize extension Wasm in the user's process. All compilation, pointer analysis, memory lowering, optimization, validation, and packaging happen in the controlled extension build environment.

Each extension continues to have one importable TypeScript wrapper. The wrapper contains a statically declared artifact map, selects the exact artifact requested by the active PGlite runtime, and exposes explicit overrides for bundlers and deployment systems that cannot use the default asset URLs.

The six-way matrix is an implementation and distribution concern, not six user-facing extension APIs. Normal usage remains:

```ts
import { vector } from '@electric-sql/pglite/vector'

const postmaster = await PGlitePostmaster.create({
  extensions: { vector },
})
```

The matrix will be introduced incrementally:

| Milestone | Supported extension targets                                                    |
| --------- | ------------------------------------------------------------------------------ |
| A         | `wasm32-classic`, `wasm32-multi-memory`                                        |
| B         | Milestone A plus `wasm32-faceted`                                              |
| C         | All wasm32 targets plus classic, faceted, and multi-memory variants for wasm64 |

The target vocabulary, manifest, wrapper, and resolver are designed for the final six-target state from the beginning. Artifact maps are intentionally partial during Milestones A and B. This allows the current classic and multi-memory work to be tied into the final API without pretending that faceted or wasm64 artifacts already exist.

The current implementation scope stops at the `wasm32-initial` profile. The
faceted runtime and all wasm64 feasibility and implementation work are
deliberately deferred. Their target keys and type fields remain reserved so
Milestone A does not create a second migration later.

## 2. Decision

PGlite will prefer prebuilt extension variants over client-side Wasm processing.

This decision is based on the following properties:

- users execute the exact bytes produced and tested by the release pipeline;
- the full build-time optimizer can specialize each topology without being shipped to users;
- pointer provenance and memory-domain mistakes fail while building or publishing an extension;
- artifacts have stable hashes, source maps, symbols, and stack traces;
- the browser or Node process does not need a Wasm parser, Binaryen, or a PGlite-specific binary rewriter;
- startup can use normal Wasm compilation and caching rather than first constructing another module;
- Content Security Policy, integrity checking, CDN caching, and service-worker caching remain conventional;
- the failure surface is artifact selection and loading, not runtime code generation.

The accepted costs are:

- six backend builds for a fully portable native extension;
- larger npm packages and deployment asset sets;
- more build and test time;
- release tooling that must prevent missing or mismatched matrix entries.

These costs are preferable to placing a correctness-critical extension transformation step in every PGlite application.

## 3. Scope

This document specifies:

- the extension target identity;
- the generated artifact layout and metadata;
- the TypeScript wrapper contract;
- runtime selection and fallback rules;
- explicit artifact-location overrides;
- compatibility with the existing extension wrapper API;
- build, validation, testing, and publishing requirements.

This document does not specify the implementation of the classic, faceted, or multi-memory PostgreSQL core builds. It treats those as independently defined PGlite runtime targets.

The faceted core and its generated single-memory accessor ABI are specified in `multi-session-worker-faceted-memory-design.md`. This document owns how that core and its extension variants are identified, selected, packaged, and published.

## 4. Terminology

**Frontend wrapper**
The importable TypeScript/JavaScript object that integrates an extension with PGlite. It can expose a JavaScript namespace, initialization and shutdown hooks, Emscripten options, and backend artifacts.

**Backend extension artifact**
The distributable extension payload for one exact target. In the current PGlite extension system this is normally a compressed tar archive containing SQL and control files, data files, and one or more Wasm dynamic libraries stored with `.so` names. It is not necessarily a single `.wasm` file.

**Target**
The combination of pointer width, memory topology, PostgreSQL ABI identity, and PGlite extension ABI required to load an artifact safely.

For a wasm64 target, pointer width and Wasm memory address width are both 64. A lowered wasm32 memory carrying a 64-bit source-language pointer ABI is not an interchangeable implementation of the target.

**Artifact map**
The wrapper's statically declared mapping from target keys to default artifact locations.

**Artifact locator**
A user-provided function that replaces a wrapper's default artifact URL. It selects a location; it does not change or process the artifact.

**Native extension**
A PostgreSQL extension containing Wasm side modules. A SQL-only or frontend-only PGlite extension need not provide six different payloads.

## 5. Why the target dimensions are real

### 5.1 Pointer width is an ABI boundary

wasm32 and wasm64 builds use different C pointer widths. This can change:

- the size and alignment of C structures;
- PostgreSQL `Datum` and pass-by-value decisions;
- function signatures involving pointers;
- relocations and address calculations;
- allocator and dynamic-linking metadata;
- extension code generated by Clang and Emscripten.

A native wasm32 extension must not be loaded into a wasm64 PostgreSQL runtime, or vice versa. The wrapper and loader must never infer cross-width compatibility from an extension name or PostgreSQL version.

### 5.2 Memory topology is a Wasm and code-generation boundary

Classic, faceted, and multi-memory builds can differ in:

- whether an imported memory is shared or unshared;
- how many memories a side module imports;
- which memory index an instruction addresses;
- how tagged or classified pointers are decoded;
- whether a dereference is direct, dispatched, or guarded;
- atomic and wait/notify behavior;
- dynamic-linking imports and runtime glue.

These differences are encoded in the module and its instructions. A loader must select a module built for the active topology, not attempt to instantiate the nearest available variant.

### 5.3 Not every extension needs six distinct byte sequences

The packaging model permits two or more target entries to reference the same URL when the build system proves the payload is identical. Examples include:

- a frontend-only extension with no backend files;
- a SQL-only extension;
- an extension archive containing only architecture-neutral data and SQL;
- future cases where two targets deliberately share a validated side module.

This is an optimization performed and recorded during the build. The runtime still requests an exact target and does not assume equivalence.

## 6. Runtime selection

### 6.1 Selection metadata is static and available before setup

Every registered native extension must expose a static backend descriptor. The descriptor lists supported target keys, compatibility metadata, required preload libraries, expected hashes, and default artifact URLs without calling `setup()`, fetching an archive, or starting PostgreSQL.

Frontend `setup()` is not an artifact-discovery mechanism in the multi-runtime API. This removes the ordering cycle in which PostgreSQL would need to start before an extension could reveal whether it supports the selected core.

The existing `PGlite` constructor selects the classic topology. Its default pointer width remains wasm32 unless wasm64 is explicitly requested.

`PGlitePostmaster.create()` considers only multi-session candidates:

1. multi-memory when the exact required feature combination is available;
2. faceted when shared Wasm memory is available;
3. otherwise a clear unsupported-runtime error.

It must never silently select classic because classic cannot preserve the postmaster's multi-session contract. wasm64 is initially explicit rather than automatically selected merely because the engine supports it.

### 6.2 Selection and loading are separate stages

Construction proceeds in three stages:

1. **Enumerate:** synchronously inspect the core artifact registry and every registered extension's static target descriptors.
2. **Select:** intersect exact engine and host capabilities, available core targets, requested pointer width/topology, and declared extension targets and host-capability requirements.
3. **Resolve and load:** apply location overrides, fetch or open the exact selected artifacts, validate hashes and contents, and materialize them before PostgreSQL starts.

```text
engine capabilities
    ∩ available core artifacts
    ∩ statically declared extension targets
    ∩ statically declared extension host requirements
    ∩ explicit user constraints
    = selected runtime target
```

Artifact locators run only in stage 3. They change where a declared artifact is loaded from; they do not advertise additional target compatibility.

Feature detection validates the exact Wasm combination required by a target rather than using user-agent detection. For example, `wasm64-multi-memory` needs one probe covering memory64, shared memory, multiple memories, and the required atomic instructions together.

### 6.3 Fallback is limited to declared pre-start availability

Automatic selection may reject a candidate because an extension descriptor does not declare that target or its static host requirements are not available for that candidate. It may then select another compatible topology before any core has started.

After selection, the following are fatal and must not cause fallback:

- a missing file or HTTP error;
- an archive digest mismatch;
- malformed or inconsistent metadata;
- a side-module ABI/import mismatch;
- Wasm validation, compilation, relocation, or instantiation failure.

These failures can indicate corruption or a toolchain/runtime defect rather than missing feature support.

The target cannot change after PostgreSQL starts. An extension loaded later through `CREATE EXTENSION` must already be registered for the active target. Late loading never downgrades or restarts a live runtime implicitly.

## 7. Artifact identity and metadata

### 7.1 Stable target and ABI identity

The public TypeScript model uses structured target data and derives filename keys from it:

```ts
export type PGlitePointerWidth = 32 | 64

export type PGliteMemoryTopology = 'classic' | 'faceted' | 'multi-memory'

export interface PGliteWasmTarget {
  pointerWidth: PGlitePointerWidth
  memoryAddressWidth: PGlitePointerWidth
  topology: PGliteMemoryTopology
  postgresMajor: number
  postgresAbi: string
  pgliteExtensionAbi: string
  memoryAbi: string
  hostAbi: string
}
```

The identities have distinct purposes:

- `postgresAbi` covers PostgreSQL headers, configured C ABI, catalog-visible ABI decisions, and extension-facing build options;
- `pgliteExtensionAbi` covers the dynamic-linking and PGlite extension contract;
- `memoryAbi` covers pointer tags, apertures, memory import names/types/limits, and transform semantics;
- `hostAbi` covers PGlite-libc imports/exports and JavaScript callback signatures.

An exact core build ID and toolchain provenance are also recorded for diagnostics and reproducibility, but Phase 0 must decide which changes truly require extension rebuilds. The short six target keys are convenient generated identifiers, not a sufficient compatibility check.

For the six public targets, `pointerWidth` and `memoryAddressWidth` are equal. Keeping both values explicit prevents a toolchain compatibility-lowering mode from being mislabeled as full wasm64 and allows the actual module audit to compare its imported memory address types with the descriptor.

### 7.2 External artifact descriptor and internal manifest

The generated TypeScript wrapper carries an external descriptor for each target:

```ts
export interface PGliteExtensionArtifactDescriptor {
  targetKey: PGliteWasmTargetKey
  target: PGliteWasmTarget
  url: URL
  archiveBytes: number
  archiveSha256: string
  manifestSha256: string
  manifest: PGliteExtensionArtifactManifest
}
```

The descriptor is available before downloading the archive. `archiveBytes` permits an early deployment-limit check, while the loader still enforces the actual streamed byte count. Its `archiveSha256` hashes the complete compressed archive and therefore cannot live inside the archive it hashes.

The archive contains an internal manifest without a self-referential archive digest:

```ts
export interface PGliteExtensionArtifactManifest {
  formatVersion: number
  extensionName: string
  extensionVersion: string
  target: PGliteWasmTarget
  artifactDependencies: Array<{
    extensionName: string
    versionRange: string
  }>
  postgresExtensions: Array<{
    name: string
    requires: string[]
  }>
  files: Array<{
    path: string
    size: number
    sha256: string
    kind: 'side-module' | 'sql' | 'control' | 'data' | 'other'
  }>
  sideModules: Array<{
    logicalName: string
    path: string
    sha256: string
    wasmAbiSection: string
    importsHash: string
    loadAfter: string[]
  }>
  requiredSharedPreloadLibraries: string[]
  processConfig: {
    pgliteEnv: Record<
      string,
      | string
      | number
      | boolean
      | {
          artifactPath: string
        }
    >
    requiredHostCapabilities: string[]
  }
  capabilities: {
    directSharedMemory: boolean
    backgroundWorkers: boolean
    parallelWorkers: boolean
  }
}
```

The internal manifest occupies one reserved canonical archive path. It is not included in its own `files` array; the exact permitted archive set is that one manifest plus the paths declared by `files`. The wrapper's generated manifest copy must hash to `manifestSha256` using the canonical serialization and must match the archive's internal manifest after extraction. Default and relocated URLs retain the generated expected digests.

A completely custom artifact override supplies a complete descriptor, including its target, URL, and expected hashes. Milestone A deliberately accepts URLs rather than direct byte arrays: file URLs cover Node self-hosting, HTTP URLs cover Node and browser deployment, and retaining one bounded streaming loader avoids a second ownership and caching contract. A bare URL is not enough to claim a new target or replace the expected artifact bytes. Direct bytes can be added later as another complete-descriptor source without changing target selection.

`artifactDependencies` describes dependencies on other registered wrapper artifacts. `postgresExtensions` records SQL-level requirements from control files, including requirements satisfied by built-in extensions. `sideModules[].loadAfter` records dynamic-library ordering that cannot be derived reliably by the loader. The build verifies these declarations against the extension control files and link metadata where possible.

`processConfig` is declarative and structured-cloneable. `pgliteEnv` replaces safe uses of the classic `emscriptenOpts.PGLITE_ENV` mutation. An `{ artifactPath }` value is resolved under that artifact's verified materialization root; it cannot escape the root. New Wasm imports or executable JavaScript hooks are not process configuration and still require a versioned PGlite host ABI.

### 7.3 Validate actual Wasm, not only metadata

The archive and wrapper manifests are indexing and integrity aids. The PGlite dynamic loader must also inspect every actual side module before relocation or instantiation.

For multi-memory modules this retains the existing fail-closed checks for:

- exactly one compatible `pglite.multi-memory.abi` custom section;
- pointer ABI and tag values;
- private, global, and scoped apertures;
- exact memory import names, address widths, sharedness, minima, and maxima;
- preserved and compatible `dylink.0` metadata;
- allowed Wasm features, imports, exports, tables, and relocations;
- consistency between the module, internal manifest, and external descriptor.

Equivalent topology-specific checks apply to classic, faceted, and wasm64 modules. A valid-looking manifest must never make incompatible Wasm loadable.

### 7.4 Safe and atomic archive materialization

An expected digest makes an archive identifiable; it does not make extraction intrinsically safe. The common classic and postmaster loader must use one fail-closed materialization path:

1. enforce configured compressed-size and download limits while reading the artifact;
2. validate `archiveSha256` before decompression;
3. decompress into an isolated staging root while enforcing maximum expanded bytes, entry count, and per-file size;
4. reject absolute paths, empty or non-canonical components, `..`, NULs, devices, FIFOs, symlinks, hard links, and any path escaping the staging root;
5. require the extracted regular-file set to equal the manifest's reserved path plus `files`, with directories derived only from those canonical paths and no undeclared entries;
6. validate every contained hash and audit every side module in the staging root;
7. check dependencies, process configuration, and cross-artifact path ownership for the complete registered extension set;
8. atomically publish the completed extension root only after every artifact passes;
9. remove all staged state on cancellation, failure, or postmaster-construction rollback.

Runtime defaults set conservative limits. A deployment may raise them explicitly, but cannot disable canonical path validation, manifest equality, hashing, or side-module audits. The loader never installs a partially extracted or partially validated extension set.

Materialization targets PGlite's pluggable VFS contract, not Node filesystem primitives. A backend with atomic rename may publish a staged root by rename; another backend may keep staging unreachable and atomically publish a logical root mapping before any PostgreSQL process starts. The contract therefore does not require WasmFS and remains implementable by existing third-party filesystem backends. `{ artifactPath }` process-config values resolve to logical paths in that published VFS root, never host filesystem paths.

### 7.5 No silent nearest-match behavior

The following substitutions are forbidden:

- wasm32 for wasm64 or wasm64 for wasm32;
- classic for faceted;
- faceted for multi-memory;
- another PostgreSQL, PGlite extension, memory, or host ABI;
- a side module whose inspected import/custom-section contract differs from its manifest.

If an exact artifact is absent from the static descriptors, target selection may choose another compatible core topology before startup. After startup, absence is an error.

## 8. Wrapper and extension lifecycle API

### 8.1 Preserve one logical extension import

The generated wrapper declares every default descriptor and URL statically:

```ts
import { defineExtension } from '@electric-sql/pglite'
import classicManifest from '../release/vector.wasm32-classic.json'
import multiMemoryManifest from '../release/vector.wasm32-multi-memory.json'

export const vector = defineExtension({
  name: 'vector',
  backend: {
    artifacts: {
      'wasm32-classic': {
        targetKey: 'wasm32-classic',
        target: classicManifest.target,
        url: new URL(
          '../release/vector.wasm32-classic.tar.gz',
          import.meta.url,
        ),
        archiveBytes: classicManifest.archiveBytes,
        archiveSha256: classicManifest.archiveSha256,
        manifestSha256: classicManifest.manifestSha256,
        manifest: classicManifest.extensionManifest,
      },
      'wasm32-multi-memory': {
        targetKey: 'wasm32-multi-memory',
        target: multiMemoryManifest.target,
        url: new URL(
          '../release/vector.wasm32-multi-memory.tar.gz',
          import.meta.url,
        ),
        archiveBytes: multiMemoryManifest.archiveBytes,
        archiveSha256: multiMemoryManifest.archiveSha256,
        manifestSha256: multiMemoryManifest.manifestSha256,
        manifest: multiMemoryManifest.extensionManifest,
      },
    },
  },
  sessionSetup: async (_session) => ({}),
})
```

The generated form eventually contains all supported targets. The important properties are that target metadata is available synchronously and every default URL is syntactically visible to bundlers. No filename is assembled from runtime strings.

### 8.2 Split backend, cluster, and session concerns

The multi-runtime extension contract separates three lifetimes:

```ts
export interface Extension<TNamespace = unknown> {
  name: string
  dependsOn?: readonly string[]
  backend?: ExtensionBackendDescriptor
  clusterSetup?: ExtensionClusterSetup
  sessionSetup?: ExtensionSessionSetup<TNamespace>
}

export interface ExtensionBackendDescriptor {
  artifacts: Partial<
    Record<PGliteWasmTargetKey, PGliteExtensionArtifactDescriptor>
  >
}
```

- `backend` is static, cluster-owned, and available before target selection. It supplies archives, compatibility, capabilities, and preload requirements.
- `clusterSetup` runs at most once after the cluster is ready, using a dedicated internal administrative session when SQL is required. Its close hook runs once during cluster shutdown.
- `sessionSetup` runs for each returned `PGlitePostmasterSession`. It attaches parsers, serializers, and namespace methods to that session; its close hook is session-scoped.

Backend archives are verified and materialized once into a cluster-visible extension root before the postmaster starts. Every backend, auxiliary process, and background worker sees the same files. Each process nevertheless performs its own dynamic relocation and instantiation against its private `WebAssembly.Table` and bound memories. Compiled code may be cached or cloned where supported, but a linked instance, relocation state, mutable globals, and table entries are never shared between PostgreSQL processes.

`requiredSharedPreloadLibraries` comes from the static backend descriptor and is applied before postmaster startup. It cannot be returned by a late session setup hook.

The existing arbitrary `emscriptenOpts` hook remains supported by classic `PGlite` during migration. It is not automatically supported by `PGlitePostmaster`: non-cloneable JavaScript changes cannot be injected safely into every Worker. A postmaster extension requiring new Wasm imports or host behavior must use a versioned PGlite host ABI implemented in the core/worker runtime.

Cloneable per-process configuration is supported through the selected artifact manifest's `processConfig`. The supervisor validates and merges it before spawning any process, resolves artifact-relative values only after safe materialization, and sends the resulting immutable configuration to every Worker before its Emscripten module factory runs. This covers official extensions such as PostGIS that need environment entries and archive-relative data paths without restoring arbitrary `emscriptenOpts` mutation.

Applications must register the backend artifacts required by an installed native extension on every cluster start, matching current PGlite's requirement to provide its extension bundles. The cluster may cache verified bytes, but an already-installed SQL catalog entry does not make missing binary artifacts compatible or loadable.

### 8.3 Dependency, ownership, and preload ordering

The supervisor constructs one dependency graph for all registered extensions before resolving artifacts. Wrapper `dependsOn` edges cover frontend-only dependencies; selected manifest `artifactDependencies` cover backend packages. Missing dependencies, version-range mismatches, and cycles are fatal before download. A stable topological sort uses application registration order only to break ties between otherwise independent extensions.

Materialization constructs a file-ownership map across the complete selected artifact set. Directories may be shared. Two artifacts may co-own a regular file only when its kind, canonical path, and content hash are identical; differing content at one path is a fatal conflict. The error names both artifacts and the colliding path. Removing or replacing one extension never removes a file still owned by another.

Side-module preload order comes from the dependency graph and fully qualified `sideModules[].loadAfter` identifiers of the form `extensionName:logicalName`, not archive order or filename sorting. The build rejects duplicate logical names, missing or cyclic side-module edges, and cross-artifact edges without a corresponding artifact dependency. Runtime inspection verifies that the declared ordering is consistent with imports and dynamic-link metadata where that relationship is observable.

`requiredSharedPreloadLibraries` is aggregated in dependency order, deduplicated while preserving the first occurrence, and merged with application-required libraries. The postmaster verifies the effective setting before startup. An immutable PostgreSQL configuration that omits a required library, or two extensions that require incompatible preload ordering, causes a pre-start error rather than a partial startup.

Process configuration uses the same dependency order. Core-owned keys cannot be set by extensions. Identical values from multiple extensions are co-owned; different values for one key fail unless a future versioned merge policy explicitly defines that key. Resolved configuration and its contributing extension identities appear in startup diagnostics.

### 8.4 Typed postmaster sessions and namespace rules

The extension map supplied to `PGlitePostmaster.create()` determines the TypeScript namespace surface of every session:

```ts
export type PGlitePostmasterExtensions = Record<string, Extension<unknown>>

export type PGlitePostmasterSessionWithExtensions<
  TExtensions extends PGlitePostmasterExtensions,
> = PGlitePostmasterSession & InitializedExtensions<TExtensions>

export declare class PGlitePostmaster<
  TExtensions extends PGlitePostmasterExtensions = {},
> {
  static create<const TExtensions extends PGlitePostmasterExtensions>(
    options: PGlitePostmasterOptions<TExtensions>,
  ): Promise<PGlitePostmaster<TExtensions>>

  createSession(
    options?: PGlitePostmasterSessionOptions,
  ): Promise<PGlitePostmasterSessionWithExtensions<TExtensions>>
}
```

The application extension-map key is the session namespace property; `Extension.name` is the stable extension identity used for artifacts, dependencies, and diagnostics. Namespace keys that collide with existing `PGlitePostmasterSession` properties or reserved future keys are rejected before the postmaster starts. The initial API also rejects registering one backend extension identity under multiple aliases.

Cluster and session setup run in stable dependency order, with registration order as the final tie-breaker. Namespace properties become visible only after all setup hooks for that session succeed. On failure, already-created hooks close in reverse order and the session is aborted. Normal close also uses reverse dependency order. These rules apply to JavaScript-only extensions as well as extensions with backend artifacts.

### 8.5 Legacy `bundlePath` migration

The existing extension API returns one `bundlePath` from `setup()`. It continues to describe the current classic wasm32 payload during migration.

A legacy extension with only `bundlePath` is treated as `wasm32-classic` only. It cannot participate in automatic postmaster topology selection because its compatibility metadata is not available until setup. Converting it requires moving the backend archive and preload declarations into `backend.artifacts`; its frontend setup becomes `sessionSetup` or `clusterSetup` according to its lifetime.

The existing bare-`URL` entry accepted in a classic `extensions` map has the same treatment: it remains a wasm32-classic compatibility path and is not accepted by `PGlitePostmaster.create()`, whose extension map requires static descriptors.

### 8.6 Wrapper-level location override

`defineExtension()` returns a configurable extension object. Self-hosting the same generated artifacts changes only their locations and retains the expected target and hashes:

```ts
const selfHostedVector = vector.configure({
  locateArtifact(request) {
    return new URL(
      `https://static.example.com/pglite/vector/${request.targetKey}.tar.gz`,
    )
  },
})
```

A deployment pinned to one target can replace that entry with a complete descriptor:

```ts
const pinnedVector = vector.configure({
  artifact: {
    ...myGeneratedVectorDescriptor,
    targetKey: 'wasm32-multi-memory',
    url: new URL('https://static.example.com/vector.tar.gz'),
  },
})
```

The selected PGlite target must match the descriptor. A single custom descriptor is valid only when the constructor is pinned to that target or other candidates remain described by the wrapper's normal map.

### 8.7 Runtime-wide location override

Applications that self-host many unchanged extension artifacts can use one global locator:

```ts
const postmaster = await PGlitePostmaster.create({
  extensions: { vector, postgis },
  locateExtensionArtifact(request) {
    return new URL(
      `/pglite/extensions/${request.extensionName}/${request.targetKey}.tar.gz`,
      location.href,
    )
  },
})
```

Artifact location resolution order is:

1. a complete exact descriptor supplied on the configured extension;
2. the extension's `locateArtifact` override, retaining generated hashes;
3. the runtime-wide `locateExtensionArtifact` override, retaining generated hashes;
4. the wrapper descriptor's generated default URL.

Each locator changes location only. It cannot change target compatibility, expected bytes, or validation policy.

### 8.8 Resolution and lifecycle failures

Errors must report:

- extension name and version;
- selected pointer width and topology;
- requested PostgreSQL, extension, memory, and host ABI identities;
- which resolution source was used;
- whether the failure was declared absence, fetch/read failure, integrity failure, content mismatch, or Wasm incompatibility;
- the dependency chain for a missing, cyclic, or version-incompatible extension;
- both owners for a file, namespace, preload, or process-configuration conflict;
- the materialization stage and configured limit for an extraction rejection;
- how to provide an exact artifact descriptor or location override.

Cluster setup failure aborts construction and performs cluster-scoped cleanup. Session setup failure closes only the new session unless it reveals a cluster-wide invariant failure. Session close hooks cannot remove cluster-owned binaries, and cluster shutdown waits for cluster hooks after sessions have been closed.

## 9. Dual-width TypeScript and PGlite host ABI

### 9.1 Decision: select a width-specific adapter once

Memory64 does not only change the compiled C code. With the WebAssembly JavaScript BigInt integration, an i64 pointer crosses the JavaScript boundary as `bigint`, while current wasm32 pointers cross as `number`. Existing PGlite TypeScript assumes `number` in module exports, host callbacks, pointer arithmetic, tagged-address decoding, typed-array indexing, WASI structures, filesystem bridges, and dynamic-linker glue. Those assumptions must be removed before wasm64 is a supported target.

PGlite will not represent pointers throughout the implementation as an unstructured `number | bigint` union and branch at each dereference. It will select a width-specific host adapter once when a core module is created:

```ts
export type WasmPointerWidth = 32 | 64

export type RawWasmPointer<W extends WasmPointerWidth> = W extends 32
  ? number
  : bigint

export interface DecodedWasmAddress {
  memory: 'private' | 'global' | 'scoped'
  offset: number
}

export interface WasmHostAbi<W extends WasmPointerWidth> {
  readonly pointerWidth: W
  readonly maximumHostOffset: bigint
  decodeAddress(pointer: RawWasmPointer<W>, length?: number): DecodedWasmAddress
  add(pointer: RawWasmPointer<W>, byteOffset: number): RawWasmPointer<W>
  readPointer(view: DataView, byteOffset: number): RawWasmPointer<W>
  writePointer(
    view: DataView,
    byteOffset: number,
    pointer: RawWasmPointer<W>,
  ): void
}

export interface PostgresMod<W extends WasmPointerWidth> {
  // Generated exports use RawWasmPointer<W> wherever the C ABI uses a pointer.
}
```

The wasm32 adapter uses `number` arithmetic. The wasm64 adapter uses `bigint` for raw pointers and pointer arithmetic. Call sites that are generic over `W` are checked at compile time, while hot paths can bind the chosen adapter's methods once and avoid a pointer-width test per load or store.

Raw pointers are an internal host/runtime type. They must not leak through the normal `PGlite`, `PGlitePostmaster`, session, result, extension-namespace, or filesystem public APIs.

### 9.2 Decode before converting to a JavaScript number

JavaScript typed-array and `DataView` offsets remain numbers. This does not mean a wasm64 raw pointer may be coerced to a number. In particular, a tagged multi-memory pointer can place its memory-domain tag in high bits that would be lost by `Number(pointer)` even when its memory-local offset is small.

The wasm64 decoder must:

1. validate and remove the tag with `bigint` bit operations;
2. select the private, global, or scoped memory;
3. validate `accessLength` as a non-negative safe integer and convert it to `bigint`;
4. calculate `end = offset + length` as `bigint`, reject wraparound or an aperture crossing, and compare it with `BigInt(memory.buffer.byteLength)`;
5. compare both bounds with the adapter's measured `maximumHostOffset`, which may be lower than `Number.MAX_SAFE_INTEGER` because of engine or view limits;
6. convert only the already-validated memory-local start offset and length to numbers for the final JavaScript view operation.

The conversion must not perform `offset + length` in number space. Capability initialization probes the largest host-accessible memory/view offset for the selected engine and core build; it does not infer accessibility from JavaScript's theoretical safe-integer limit.

The wasm32 adapter performs the equivalent aperture and bounds checks using unsigned 32-bit semantics. Neither adapter may use coercions such as `>>> 0` outside wasm32-specific code. Function-table indices, file descriptors, process IDs, and bounded byte counts remain numbers when their host ABI type is explicitly fixed-width; they must not be confused with pointers merely because Emscripten sometimes represents both as JavaScript numbers in wasm32.

### 9.3 Use PGlite-libc as the stable bridge

The preferred fix for a pointer-width-dependent JavaScript structure is to stop exposing that structure. PGlite-libc should flatten or adapt native structures and present a small, versioned host ABI with deliberate fixed-width types:

- use `uint32_t`/`int32_t` for file descriptors, PIDs, bounded counts, status values, registry offsets, and other values whose PGlite contract is intentionally limited to 32 bits;
- use `uint64_t`/`int64_t` for genuine 64-bit scalar values and expose them to TypeScript as `bigint`;
- keep real C pointers pointer-sized and expose them with Emscripten's pointer signature type;
- split or loop inside C when a native `size_t` operation can exceed the bounded size accepted by a JavaScript host operation;
- prefer libc helpers for structures such as `iovec` rather than teaching TypeScript every wasm32 and wasm64 native layout.

This keeps PostgreSQL-fork source changes minimal and localizes compatibility work in the existing PGlite abstraction layer. When JavaScript must inspect a native structure, the ABI supplies an explicit width-specific layout descriptor rather than relying on hard-coded offsets such as a wasm32 eight-byte `iovec`.

### 9.4 Generate host declarations and callback signatures

One machine-readable host-ABI schema should generate or validate:

- `PostgresMod<32>` and `PostgresMod<64>` export declarations;
- every PGlite-libc import and export signature;
- Emscripten `addFunction` signatures, including which parameters are pointers, i64 scalars, i32 scalars, or function-table indices;
- width-specific native structure layouts that cannot be removed from the boundary;
- the `hostAbi` compatibility identity recorded in core and extension manifests.

In Emscripten signatures, pointer parameters use the pointer-width-aware `p` type and genuine i64 values use `j`. Memory64 therefore still requires native BigInt handling at JavaScript callback boundaries. Emscripten signature-conversion options may help migrate selected exported functions, but they are not the design: they do not remove BigInt from all callbacks, cannot safely encode tagged high-bit pointers as JavaScript numbers, and must not conceal an ABI mismatch.

### 9.5 Migration inventory

Before a wasm64 build is considered usable, the audit must cover at least:

- all pointer-bearing declarations in `postgresMod.ts` and generated module glue;
- UTF-8 helpers, stack allocation, `fopen`, errno, process-port access, and returned C strings;
- the classic and postmaster host callbacks in `pglite.ts`, `process-host.ts`, and `socket-host.ts`;
- tagged pointer decoding and memory-domain dispatch;
- filesystem `mmap` and initdb bridges;
- WASI vectors and any other pointer-width-dependent native structure;
- dynamic-side-module relocation, table, and symbol handling;
- extension-provided host imports and namespace setup.

An audit should reject pointer-shaped APIs that remain typed as a bare `number`. It should also reject accidental use of `bigint` for fixed-width handles that are intentionally numbers.

### 9.6 Dual-width validation gates

The host ABI test suite must include:

- compile-time fixtures that type the same generic host code against both widths;
- wasm32 and wasm64 callback round trips for every generated signature shape;
- high-bit tagged wasm64 pointers whose complete raw value cannot be represented safely as a number;
- offsets on both sides of 4 GiB and explicit rejection beyond the supported aperture or measured `maximumHostOffset`;
- boundary and overflow tests proving `offset + length` stays in BigInt space until validation completes;
- a full-memory64 module fixture and rejection of a compatibility-lowered i32-addressed module claiming the same target;
- differential tests showing the wasm32 and wasm64 adapters choose the same memory domain and byte location for equivalent logical addresses;
- WASI, filesystem, socket, dynamic-linking, cancellation, and signal tests at both widths;
- a lint or generated-code check preventing new unclassified pointer declarations.

Passing SQL tests alone is insufficient because ordinary databases may never exercise a pointer above 4 GiB or a tagged value whose high bits expose an unsafe conversion.

## 10. Bundler behavior

### 10.1 Default path

PGlite's existing extension wrappers use `new URL(relativePath, import.meta.url)`. The generated six-artifact wrapper continues this approach because many bundlers can discover and emit these assets.

Only the selected artifact is fetched or opened at runtime. A bundler may nevertheless copy all six files into its deployment output. That is acceptable for the default universal wrapper.

### 10.2 Explicit escape hatch

PGlite will not claim universal bundler support. When a bundler cannot preserve the default URLs, the documented solution is `artifact`, `locateArtifact`, or `locateExtensionArtifact`, not runtime Wasm rewriting or filename guessing.

### 10.3 Optional size-focused exports

If package or deployment size becomes a material problem, an extension may additionally publish generated target-family entry points:

```ts
import { vector } from '@electric-sql/pglite-vector/wasm32'
```

Such an entry point can include only the three wasm32 artifacts. Exact-target entry points may be added for specialized deployments, but they are an advanced optimization and must not become the normal extension installation experience.

The universal wrapper remains the canonical public entry point.

## 11. Build and release pipeline

### 11.1 Matrix build

The extension SDK builds each native extension for all required targets in the pinned PGlite build environment:

```text
extension source
    ├── wasm32 classic
    ├── wasm32 faceted
    ├── wasm32 multi-memory
    ├── wasm64 classic
    ├── wasm64 faceted
    └── wasm64 multi-memory
```

Each variant passes through the topology's production static analysis, memory-instruction lowering, optimizer, and validator. No equivalent pass is deferred to the client.

The build should share source compilation and intermediate caches where toolchain correctness permits, but caching must not blur the target identity. Shared and unshared memory modes and wasm32/wasm64 compiler inputs must be applied at every stage required by Emscripten and the extension's build system.

All wasm64 matrix entries use the pinned toolchain's full end-to-end memory64 mode. The validator rejects compatibility-lowered modules whose C pointer ABI is 64-bit but whose Wasm memory address type is i32. Compiler and linker flags are recorded in diagnostic provenance and the actual memory address type is part of the audited target contract.

### 11.2 Generated outputs

The release pipeline generates:

- one backend archive for every supported target;
- an internal manifest for every archive and an external descriptor containing the archive and manifest digests;
- source maps or separate debug artifacts where supported;
- the TypeScript artifact map;
- package export entries;
- a release report showing missing, identical, and distinct variants.

The TypeScript map must be generated from the manifests. Hand-maintained six-way filename tables will drift.

### 11.3 Reproducible archives

Archive generation is part of the integrity contract and must be deterministic. Packaging tooling in the pinned build container must:

- sort archive paths byte-for-byte;
- normalize owner, group, modes, and modification times;
- exclude host-dependent metadata and undeclared files;
- produce gzip streams without a current-time header;
- canonicalize the internal manifest before calculating `manifestSha256`;
- calculate `archiveSha256` only after the complete archive exists.

CI builds each canary artifact twice from clean directories and compares both the archive bytes and external descriptors. A differing output blocks publication unless the difference is an explicitly documented non-reproducible debug companion.

### 11.4 Atomic publication

Publishing must be atomic at the logical extension-version and declared release-profile level. A release must not be published when one of the artifacts required by its profile is absent or failed validation.

The planned profiles are:

```text
wasm32-initial:
  wasm32-classic
  wasm32-multi-memory

wasm32-complete:
  wasm32-classic
  wasm32-faceted
  wasm32-multi-memory

full:
  all six targets
```

The wrapper manifest records its release profile and exact target set. A Milestone A extension is complete for `wasm32-initial`; it is not mislabeled as a six-target universal extension.

An extension that intentionally supports only a subset may be published, but its wrapper and metadata must declare that subset. It must not use placeholder copies from another target.

## 12. Testing requirements

### 12.1 Artifact validation

For every target, automated validation must check:

- Wasm validation under an engine supporting the exact feature set;
- imported memory count, address width, sharedness, minimum, and maximum;
- expected dynamic-linking imports and exports;
- transformed memory indices and pointer-domain fallbacks;
- atomic, bulk-memory, SIMD, and indirect-call policies;
- external archive and manifest hashes and every internal file hash;
- equality between the wrapper's generated manifest copy and the archive's internal manifest;
- PostgreSQL, PGlite extension, memory, and host ABI identities;
- actual custom sections, `dylink.0`, imports, exports, features, table policy, pointer tags, and apertures rather than trusting declared metadata;
- equality between declared and actual pointer and memory address widths, including rejection of compatibility-lowered wasm64 artifacts;
- deterministic archives and descriptors from two clean builds.

Materialization tests must cover compressed and expanded size limits, excessive entry counts, absolute and traversal paths, non-canonical aliases, symlinks, hard links, device entries, undeclared or missing files, cancellation cleanup, audit failure cleanup, and atomic visibility. Dependency tests cover missing and incompatible artifacts, cycles, same-hash co-ownership, conflicting file contents, side-module load order, preload aggregation, and process-configuration conflicts.

### 12.2 Extension behavior

Every native extension should run at least:

- artifact load and `CREATE EXTENSION`;
- an extension-specific smoke query;
- extension installation from two independent backend sessions;
- close and restart with the extension installed;
- expected error behavior when deliberately given a wrong target;
- multi-session behavior under faceted and multi-memory builds when the extension exposes shared or backend-local state;
- wasm32 and wasm64 result parity for representative operations.

Milestone A must include explicit gates for `shared_preload_libraries`, postmaster restart with an installed extension, EXEC_BACKEND child startup, background-worker registration and execution, multiple side modules in one archive, multiple extensions loaded by one backend, and the same extension independently relocated into multiple backend Workers. These tests verify the cluster-owned archive/per-process linked-instance split rather than only proving that one transformed `.so` can execute.

Extensions using shared memory, parallel workers, custom access methods, or direct buffer-page access require targeted concurrency tests rather than only a creation smoke test. Unsupported capabilities must be declared in the manifest and fail before startup; they must not be discovered by hanging or crashing a Worker.

### 12.3 Wrapper and bundler tests

The wrapper test suite must cover:

- enumeration and exact selection from partial and complete target maps;
- extension-constrained selection before artifact resolution;
- default `new URL()` resolution in the officially supported bundler fixtures;
- wrapper-level complete-descriptor and location-only overrides;
- the runtime-wide locator;
- Node file URLs and browser HTTP URLs where applicable;
- proof that only the selected artifact is read or fetched;
- proof that declared absence may affect pre-start selection while fetch, hash, validation, relocation, and setup failures never cause fallback;
- cluster setup once, session setup once per session, and correctly ordered close hooks;
- declarative per-process configuration in every backend and auxiliary Worker;
- compile-time inference of all configured extension namespaces on every returned postmaster session;
- reserved namespace rejection, setup rollback, and reverse-order cleanup;
- actionable failures from unsupported bundlers and missing assets.

The dual-width host tests in Section 9 are release gates for every wasm64 profile. They begin earlier as wasm32 regression tests so the abstraction is exercised before wasm64 is introduced.

## 13. Compatibility and migration

### 13.1 Existing wrappers

Current wrappers such as `pglite-pgvector` return one `bundlePath` from `setup()`. They continue to work unchanged with the existing classic wasm32 `PGlite` runtime.

Migration to the matrix consists of:

1. building and validating the additional target archives;
2. generating an artifact manifest and map;
3. moving backend artifact selection from `setup().bundlePath` to `Extension.backend.artifacts`;
4. retaining the existing setup function for frontend behavior;
5. optionally retaining `bundlePath` while older PGlite versions are supported.

### 13.2 JavaScript-only extensions

An extension that only augments the `PGliteInterface` has no backend matrix. Its manifest marks it as topology- and width-independent, and its setup and namespace behavior remain unchanged.

### 13.3 Data and SQL reuse

The six archives may duplicate SQL, control, documentation, and data files. This is initially acceptable because each archive is independently deployable and testable. If package size later warrants deduplication, the wrapper format may separate architecture-neutral resources from target-specific side modules. That optimization must not complicate the first implementation.

## 14. Operational and developer experience

The common case should remain:

```ts
import { vector } from '@electric-sql/pglite/vector'

const db = await PGlite.create({ extensions: { vector } })
```

or:

```ts
const postmaster = await PGlitePostmaster.create({
  extensions: { vector },
})
```

Users should not need to know artifact filenames, sharedness, memory indices, or pointer widths unless they opt into wasm64, pin a topology, or override asset hosting.

Diagnostics should expose the resolved target for support and benchmarking:

```ts
postmaster.runtimeTarget
// {
//   pointerWidth: 32,
//   memoryAddressWidth: 32,
//   topology: 'multi-memory',
//   postgresBuildId: '...',
//   postgresAbi: '...',
//   pgliteExtensionAbi: '...',
//   memoryAbi: '...',
//   hostAbi: '...',
// }
```

The wrapper generation command should be part of the extension SDK so third-party authors do not manually implement the matrix or locator contract.

## 15. Rejected alternatives

### 15.1 Client-side static analysis and specialization

Rejected as the default because it ships a complex correctness boundary to every application, delays failures until runtime, impairs conventional compilation and caching, and complicates integrity, debugging, and support.

### 15.2 One sharedness-polymorphic Wasm side module

Not available with current Wasm memory typing. Shared and unshared memories are distinct import types, and multi-memory instructions encode their target memory indices.

### 15.3 Filename construction without a manifest

Rejected because bundlers cannot reliably discover runtime-computed asset paths and because filenames do not prove ABI compatibility.

### 15.4 Silent runtime fallback between extension variants

Rejected because a failed instantiation may indicate corruption or a compiler bug rather than a missing feature. Topology selection happens explicitly before PostgreSQL starts.

### 15.5 Six separately documented extension imports

Rejected because it exposes an implementation matrix as application API. Target-specific entry points may exist for bundle-size optimization, but one universal wrapper is the default.

## 16. Risks and mitigations

| Risk                                                    | Mitigation                                                                                      |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| npm package size grows substantially                    | Compression, optional wasm32 entry points, later neutral-resource deduplication                 |
| release matrix increases build time                     | Container-layer and compiler-cache reuse; parallel matrix jobs                                  |
| one target is accidentally omitted                      | Generated descriptors and atomic publication gates                                              |
| wrapper metadata drifts from archive contents           | Generate both from one build record; verify internal manifest and inspect actual Wasm           |
| wrapper default fails in a bundler                      | Complete `artifact` and location-only locator overrides                                         |
| wrong side module is loaded                             | Structured ABI identities, embedded metadata, hashes, and actual module inspection              |
| unsafe or partial archive extraction                    | Bounded staging, canonical paths, exact manifest equality, and atomic publication               |
| extension files or dependencies conflict                | Pre-start dependency graph, file ownership map, hash comparison, and deterministic ordering     |
| extensions require Worker startup configuration         | Declarative cloneable process configuration; reserve host ABI changes for executable behavior   |
| automatic topology hides runtime choice                 | Expose `runtimeTarget` and allow explicit topology selection                                    |
| a late extension cannot support the target              | Require registration before startup; never mutate or downgrade a live runtime                   |
| cluster and session extension lifetimes are conflated   | Separate static backend, cluster setup/close, session setup/close, and per-process linking      |
| wasm64 raw pointers are truncated to JavaScript numbers | Keep raw pointers width-specific, decode tags as BigInt, and convert only checked local offsets |
| lowered wasm32 is mislabeled as wasm64                  | Record and audit memory address width; define public wasm64 as full end-to-end memory64         |
| pointer-width branches enter every dereference          | Bind a width-specific adapter once; generate typed callbacks and keep hot paths monomorphic     |
| wasm64 is selected without benefit                      | Default to wasm32; make wasm64 explicit initially                                               |

## 17. Phased implementation plan

The implementation is divided into foundation phases and three release milestones. Each milestone is useful on its own and leaves the public artifact model ready for the next one.

### Phase 0: Freeze the forward-compatible target contract

**Purpose:** define the six-target model before adding more artifacts, without changing current runtime behavior.

Work:

1. Define and version:
   - `PGlitePointerWidth`;
   - the distinct C pointer-width and Wasm memory-address-width fields;
   - `PGliteMemoryTopology`;
   - `PGliteWasmTarget`;
   - the six stable target keys;
   - the external artifact descriptor and non-self-referential internal manifest;
   - `PGliteExtensionArtifactManifest`;
   - the PostgreSQL, PGlite extension, memory, and host ABI identities.
2. Define named release profiles for the two-target, three-target, and six-target states.
3. Make artifact maps explicitly partial. Absence means unsupported, not “try the nearest artifact”.
4. Define the three-stage enumerate/select/resolve-load algorithm and the boundary between declared pre-start absence and fatal post-selection failure.
5. Define separate static backend, cluster setup/close, session setup/close, and per-process dynamic-link lifetimes, including the generic postmaster/session namespace result types.
6. Define wrapper and artifact dependency identities, file co-ownership rules, side-module ordering, preload aggregation, and setup/close ordering.
7. Define the declarative, cloneable per-process configuration schema and its conflict rules.
8. Define the safe extraction limits, canonical path policy, staging/rollback behavior, and atomic materialization contract.
9. Define the `artifact` complete-descriptor override and the location-only locator contracts.
10. Reserve manifest fields for wasm64 and faceted artifacts even though the first build does not produce them.
11. Decide how the PostgreSQL build identity is calculated and compared.
12. Define `RawWasmPointer<W>`, `PostgresMod<W>`, the width-specific adapter interface, and the machine-readable host-ABI schema without yet converting the runtime; choose the schema's owning source format and version-review process.
13. Freeze public wasm64 as full end-to-end memory64. The toolchain feasibility spike is part of the later wasm64 work and is explicitly deferred from the `wasm32-initial` delivery; it must still run entirely inside the pinned Wasm build container before Phase 5 or 6 begins.
14. Establish checked-in test inventories and quantitative budgets for regression-suite exclusions, archive limits, startup time, per-backend extension memory, wasm32 adapter overhead, and wasm64 pointer inflation. Measurements without a pass/fail budget are not exit gates.
15. Document that `PGlitePostmaster.create()` never falls back to classic, native extensions must be registered before every startup, and wasm64 is initially explicit.

Exit gate:

- the types can represent all final targets without another API redesign;
- a manifest fixture for every target key validates;
- external archive hashes do not create a recursive internal manifest;
- partial maps, selection, dependency, materialization, process-configuration, lifecycle, namespace, and exact-target errors have specified behavior;
- width-specific raw pointers can be expressed without exposing them in the public PGlite API;
- wasm64 is represented without compatibility lowering being mislabeled as memory64, while its explicitly deferred feasibility proof remains a prerequisite for the wasm64 phases;
- benchmark and regression gates name their inputs, exclusions, and numerical budgets;
- no production artifact or constructor behavior has changed.

### Phase 1: Normalize the existing wasm32 classic path

**Purpose:** place the current classic extension path behind the new identity, manifest, and location APIs while preserving existing behavior.

Work:

1. Identify the existing core runtime as `wasm32-classic`.
2. Make classic extension archive creation deterministic and produce the internal manifest plus external descriptor.
3. Add `Extension.backend.artifacts` and `defineExtension()` while retaining legacy `setup().bundlePath` support.
4. Treat a legacy `bundlePath` with no additional metadata as `wasm32-classic` only.
5. Implement archive, manifest, contained-file, PostgreSQL, extension, memory, and host ABI validation, including inspection of the actual side module.
6. Implement resolution order:
   - configured exact artifact;
   - extension `locateArtifact`;
   - runtime-wide `locateExtensionArtifact`;
   - generated wrapper URL.
7. Replace classic archive extraction with the bounded staging, exact-manifest, ownership, cleanup, and atomic-publication path from Section 7.4.
8. Implement declarative process configuration and the backend/cluster/session lifecycle split through a classic compatibility adapter.
9. Add the location-only escape hatch for bundlers that cannot preserve `new URL(..., import.meta.url)` and the complete-descriptor escape hatch for custom bytes.
10. Convert one small native extension wrapper and one extension that currently changes `PGLITE_ENV` to the generated artifact-map form.
11. Add classic wrapper, bundler, self-hosted URL, corrupt-descriptor, malicious-archive, extraction-limit, rollback, wrong-target, missing-asset, process-configuration, and reproducible-build tests.

Exit gate:

- current classic extension behavior remains unchanged for ordinary users;
- the converted extension loads through its `wasm32-classic` descriptor and lifecycle hooks;
- an explicitly supplied artifact location works in Node and the relevant bundler fixtures;
- a mismatched, corrupt, unsafe, oversized, or conflicting artifact is rejected before publication or `dlopen()`;
- the converted environment-dependent extension no longer needs arbitrary `emscriptenOpts` mutation.

### Phase 2: Productize wasm32 multi-memory extensions

**Purpose:** turn the existing successful single-side-module proof into a cluster-owned, multi-process product path using the same wrapper and descriptors as classic.

The current proof has already transformed, audited, copied, dynamically linked, and executed a multi-memory `.so` in one live backend. This phase preserves that evidence. Its main gap is the surrounding extension product: selection, packaging, cluster materialization, Worker startup, per-process linking, and frontend lifecycle.

#### Phase 2A: Build the postmaster extension loader

1. Identify the multi-memory postmaster core as `wasm32-multi-memory` and expose its full structured target identity before startup.
2. Accept registered extension descriptors in `PGlitePostmaster.create()` and include them in pre-start topology selection.
3. Validate the complete wrapper/artifact dependency graph, versions, namespace keys, side-module order, preload order, and process-configuration merge before startup.
4. Resolve, verify, safely stage, and atomically materialize the selected artifact set once into a cluster-visible extension root before starting PostgreSQL.
5. Apply the deterministic effective `requiredSharedPreloadLibraries` value before postmaster startup.
6. Send the resolved immutable process configuration to every Worker before its module factory runs.
7. Make backend, auxiliary, EXEC_BACKEND, and background-worker processes see the same materialized files.
8. Perform dynamic relocation and instantiation separately inside every Worker against that process's private table and bound memories; share verified or compiled immutable bytes only where safe.
9. Add a dedicated administrative session for cluster setup and return the generic normal `PGlite` session surface intersected with every configured extension namespace.
10. Implement dependency-ordered setup and reverse-ordered session and cluster cleanup, including partial-construction failure.

#### Phase 2B: Promote the side-module toolchain

1. Move the existing transformation into the pinned extension build container and production build graph.
2. Complete and version:
   - pointer-domain classification;
   - generic fallback for unknown provenance;
   - memory-index lowering;
   - shared-memory and atomic handling;
   - dynamic-linking metadata updates;
   - source-map preservation;
   - the `pglite.multi-memory.abi` custom section and post-transform validation.
3. Generate deterministic `wasm32-multi-memory` archives, internal manifests, and external descriptors entirely inside the build container.
4. Make the loader re-audit exact memory imports, address types, sharedness, limits, `dylink.0`, tags, apertures, features, imports, exports, and ABI section on the actual module before relocation.

#### Phase 2C: Qualify two canary extensions

1. Make the generated wrapper for a small and a complex extension declare both initial wasm32 artifacts statically.
2. Test extensions that exercise:
   - ordinary backend-private allocations;
   - pointers into shared PostgreSQL state;
   - atomics or locks;
   - multiple Wasm side modules;
   - dependencies and ordered preloads;
   - declarative environment and artifact-relative data paths;
   - extension data and SQL files.
3. Add concurrency tests using at least two real PostgreSQL sessions and repeated backend creation/destruction.
4. Expose `runtimeTarget` for diagnostics and test assertions.
5. Prove that declared target absence can influence selection but fetch, integrity, validation, relocation, and setup failures are fatal after selection.
6. Prove namespace inference at compile time and dependency, collision, configuration-conflict, unsafe-archive, and rollback behavior at runtime.

Exit gate:

- one small and one complex native extension pass on both `wasm32-classic` and `wasm32-multi-memory`;
- multi-memory extensions are fully transformed and optimized during the build, with no client processing;
- the postmaster rejects classic-only, missing, or mismatched registered extensions before starting when multi-memory is required;
- multiple Workers independently link the same cluster-owned extension bytes without sharing mutable instance state;
- multi-session extension tests demonstrate correct isolation and shared-state behavior;
- source maps and failure diagnostics identify the selected target.

### Phase 3: Complete Milestone A across the extension ecosystem

**Purpose:** turn the two working variants into a repeatable `wasm32-initial` release profile rather than a canary-only path.

Work:

1. Check in the exact `wasm32-initial` official postmaster-extension inventory. Generate both target artifacts for every extension in that inventory; extensions outside it are explicitly unsupported by the Milestone A postmaster and do not count toward completion.
2. Generate wrapper maps and manifests rather than maintaining filenames by hand.
3. Add atomic publication gates for the `wasm32-initial` profile.
4. Add extension-SDK commands for third-party two-target builds.
5. Put all compiler, transformer, auditor, archive, and wrapper-generation tooling inside the pinned Docker image used to build Wasm.
6. Add CI gates for target validation, actual-module audits, extension smoke tests, concurrency-sensitive extensions, and supported bundlers.
7. Add explicit integration tests for:
   - `shared_preload_libraries` before postmaster startup;
   - EXEC_BACKEND process startup;
   - background-worker registration, execution, and shutdown;
   - close and postmaster restart with an installed extension;
   - multiple side modules in one archive;
   - multiple extensions and multiple backend Workers in one cluster.
8. Run PostgreSQL `make check` and `make check-world` through the socket frontend, plus every applicable extension `installcheck` suite, with the official extension set registered. Check in the expected skip/exclusion ledger; a new skip, timeout, Worker crash, or unexpected failure blocks the milestone.
9. Measure npm package size, emitted deployment size, download behavior, startup time, per-backend linked-instance memory, and process-configuration overhead against the Phase 0 budgets.
10. Document the universal wrapper and complete-descriptor and location-only overrides.
11. Retain the existing simple wrapper import as the normal developer experience.

Exit gate — **Milestone A**:

- classic wasm32 and multi-memory wasm32 are supported release targets;
- every native extension in the checked-in Milestone A postmaster inventory publishes and passes both targets;
- PostgreSQL `make check`, `make check-world`, and applicable extension suites pass within the checked-in exclusion and timeout policy;
- the build and publishing pipeline cannot accidentally publish an incomplete two-target release;
- startup, memory, package-size, and per-backend overhead remain within the frozen budgets;
- third-party extension authors can reproduce the same artifact structure using supported tooling.

At this milestone, `PGlitePostmaster.create()` requires the multi-memory feature set. A runtime with SAB but without Wasm multi-memory is not yet supported by the postmaster build.

### Phase 4: Add the wasm32 faceted fallback

**Purpose:** support multi-session PGlite where shared Wasm memory is available but Wasm multi-memory is not.

Work:

1. Implement, produce, and validate the `wasm32-faceted` core postmaster and accessor artifacts specified by `multi-session-worker-faceted-memory-design.md`.
2. Add an exact capability probe for the faceted shared-memory requirements.
3. Add postmaster topology selection:

   ```text
   multi-memory when available
       ↓ otherwise
   faceted when shared Wasm memory is available
       ↓ otherwise
   unsupported PGlitePostmaster error
   ```

4. Produce `wasm32-faceted` extension variants using the build-time static analysis and lowering pipeline.
5. Add the faceted entry to generated wrappers and manifests.
6. Include the registered extension set when selecting between multi-memory and faceted before startup.
7. Ensure extension APIs and SQL-visible behavior do not depend on which multi-session topology was selected.
8. Add parity tests between faceted and multi-memory for:
   - extension installation;
   - concurrent sessions;
   - shared state;
   - background workers where supported;
   - parallel behavior where supported;
   - cancellation and shutdown.
9. Add tests proving that instantiation or validation bugs do not trigger a silent topology downgrade after selection.
10. Extend the release and bundler tests to the three-artifact wasm32 wrapper.

Exit gate — **Milestone B**:

- all three wasm32 targets are buildable, validated, published, and selectable;
- `PGlitePostmaster.create({ topology: 'auto' })` prefers multi-memory and selects faceted only when static capability probing or the declared core/extension target intersection rules out multi-memory before loading;
- a fetch, hash, audit, compilation, relocation, or startup failure never triggers a faceted retry;
- `PGlitePostmaster` still never degrades to classic;
- every extension in the checked-in wasm32 postmaster inventory satisfies the `wasm32-complete` release profile;
- applications continue to import one wrapper and normally fetch only the selected target.

### Phase 5: Make the TypeScript and PGlite-libc host ABI dual-width

**Purpose:** remove wasm32-only JavaScript assumptions before a wasm64 core becomes responsible for finding them at runtime.

Work:

1. Inventory all pointer-bearing module exports, callbacks, Emscripten signatures, pointer arithmetic, typed-array accesses, memory decoders, filesystem bridges, WASI structures, socket paths, dynamic-linker operations, and extension hooks.
2. Introduce `PostgresMod<W>`, `RawWasmPointer<W>`, and width-specific wasm32/wasm64 host adapters selected once per module.
3. Keep wasm64 raw pointers and arithmetic as `bigint`; decode memory tags before converting only checked local offsets to numbers.
4. Probe and expose the engine/core-specific `maximumHostOffset`; keep start/end bounds calculations in `bigint` until aperture, buffer, and host-view validation succeeds.
5. Remove unclassified `>>> 0`, `Number(pointer)`, and hard-coded wasm32 native-structure layouts from common code.
6. Move pointer-width-dependent structure handling into PGlite-libc where practical and expose deliberate fixed-width handles, counts, results, and 64-bit scalar values.
7. Generate or validate TypeScript module declarations and every `addFunction`/host import signature from the versioned host-ABI schema.
8. Bind width-specific operations outside hot loops so normal dereferences do not perform `typeof` or width branching.
9. Add compile-time, boundary, tagged-high-bit, overflow, callback round-trip, lowered-module-rejection, and differential adapter tests described in Section 9.
10. Run all existing wasm32 classic and postmaster tests through the new wasm32 adapter before enabling wasm64.

Exit gate:

- common host code contains no unexplained assumption that a C pointer is a JavaScript number;
- high-bit wasm64 pointer fixtures cannot be silently truncated even though no production wasm64 core is selected yet;
- generated signatures distinguish pointers, i64 scalars, fixed-width numbers, and table indices;
- wasm32 performance and behavior remain within the Phase 0 regression budgets.

### Phase 6: Establish the wasm64 classic ABI

**Purpose:** resolve pointer-width and PostgreSQL ABI questions in the smallest runtime before combining wasm64 with workers, shared memory, and multiple memories.

Work:

1. Build and run a full-memory64, i64-addressed `wasm64-classic` PGlite core artifact using the toolchain mode frozen in Phase 0.
2. Define the wasm64 PostgreSQL and PGlite extension ABI, including:
   - pointer and `Datum` size;
   - structure layout and alignment;
   - dynamic-linking relocation forms;
   - function-table and indirect-call conventions;
   - the already-frozen Emscripten memory64 mode and libc configuration;
   - extension control and SQL compatibility.
3. Instantiate the production module through the Phase 5 wasm64 adapter and native BigInt callback signatures; do not add a parallel ad hoc glue path.
4. Determine whether wasm32 and wasm64 runtimes may safely open the same PGlite data directory. Do not assume cross-width cluster compatibility; encode the result in cluster and artifact metadata.
5. Extend manifests, validators, wrapper resolution, and diagnostics to wasm64.
6. Compile one small and one ABI-sensitive native extension for `wasm64-classic`.
7. Add wasm32/wasm64 behavioral parity tests, pointers and mappings above 4 GiB where supported, and deliberate cross-width rejection tests.
8. Measure code size, pointer inflation, memory use, callback overhead, and startup differences.
9. Keep wasm64 explicitly selected; do not make it the automatic default.

Exit gate:

- classic wasm64 passes the required PGlite and PostgreSQL regression coverage;
- native wasm64 side modules load with a documented, versioned ABI;
- cross-width artifacts and incompatible data directories fail clearly;
- measured costs remain within the Phase 0 wasm64 budgets, or the target is not released and the failed budget is recorded;
- supported use cases for wasm64 are documented.

### Phase 7: Add wasm64 faceted and multi-memory runtimes

**Purpose:** complete the two multi-session topologies at 64-bit pointer width.

Work:

1. Extend the pointer-domain representation and memory transformer to wasm64 addresses.
2. Cover i64 address calculations, loads, stores, atomics, SIMD, bulk-memory operations, indirect calls, relocation records, and tagged host-pointer decoding.
3. Build and validate:
   - `wasm64-faceted`;
   - `wasm64-multi-memory`.
4. Add exact probes for the combined wasm64, shared-memory, atomics, and multi-memory requirements.
5. Produce both wasm64 multi-session extension variants for the canary extensions.
6. Add `PGlitePostmaster.create({ pointerWidth: 64, topology: 'auto' })` while retaining the same multi-memory-then-faceted policy.
7. Test backend churn, shared-memory behavior, scoped-memory behavior, parallel workers, extension loading, and cancellation in both topologies.
8. Test memory growth beyond the useful wasm32 range where the runtime supports it.

Exit gate:

- the canary extensions pass all six targets;
- wasm64 topology probes and selection are deterministic;
- wasm64 multi-session tests meet the same correctness gates as wasm32;
- no wasm64 failure causes an implicit switch to wasm32.

### Phase 8: Complete and harden the full six-target ecosystem

**Purpose:** make the final matrix a supported release profile for official and third-party extensions.

Work:

1. Check in the final official postmaster-extension inventory and build every extension in it for all six targets.
2. Add atomic `full`-profile publication gates.
3. Complete the extension SDK, wrapper generator, target validators, and diagnostics for the full matrix.
4. Run target-specific extension tests and representative cross-target parity tests in CI.
5. Add supported-bundler fixtures for six-artifact wrappers and all explicit-location overrides.
6. Decide from measured package sizes whether to add:
   - wasm32-only wrapper entry points;
   - optional wasm64 companion packages;
   - exact-target deployment entry points;
   - architecture-neutral SQL and data deduplication.
7. Document operational selection, explicit pinning, self-hosting, integrity verification, and troubleshooting.
8. Remove transitional assumptions that treat wasm32 classic as the only legacy artifact, while retaining an intentional compatibility path for older wrappers if required.

Exit gate — **Milestone C**:

- the final six-target matrix is supported and tested;
- one logical extension version and wrapper resolve every supported target;
- wasm32 remains the default unless product requirements deliberately change that policy;
- wasm64 is available without exposing six ordinary extension imports;
- the client selects and loads prebuilt bytes and never performs extension Wasm transformation.

## 18. Open questions

The design resolves several earlier questions: the public replacement is named `artifact`; a location-only override retains the generated descriptor and hashes; replacement bytes require a complete descriptor; wrapper metadata is available before download; and installed native extensions must be registered on every cluster startup.

The following choices remain and should be resolved in the indicated foundation or prototype phase:

- whether target-family subpath exports are worth publishing before package-size measurements exist;
- whether official extension packages should include all six assets in one npm package or place wasm64 assets in optional companion packages;
- which PostgreSQL build inputs contribute to the stable extension compatibility identity and which belong only in diagnostic provenance (Phase 0);
- whether verified archives, compiled `WebAssembly.Module` objects, or both can be cached across Workers on each supported runtime without weakening per-process linkage isolation (Phase 2);
- how source maps and debug companions are located when an application relocates an artifact;
- the exact source format and review mechanism for the generated host-ABI schema (resolved in Phase 0 before the contract freezes).

These questions affect API naming and packaging efficiency, not the primary decision: extension variants are produced, optimized, and validated ahead of time, and the client only selects and loads an exact artifact.
