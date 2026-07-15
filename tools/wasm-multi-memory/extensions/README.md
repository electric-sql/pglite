# Wasm extension artifact tooling

All compilation, transformation, auditing, deterministic packaging, and
wrapper generation runs in the pinned Wasm build image. The initial release
profile is defined by `wasm32-initial-inventory.json`; it deliberately contains
only vector and PostGIS until another extension is added with both target
artifacts and the same gates.

`build-initial.sh` consumes the ordinary classic extension archives and the
shared-memory extension archives produced by the postmaster build. It
transforms only the latter, audits each resulting module, emits deterministic
archives and descriptors, and generates the static wrapper map. Running it
twice from clean inputs must produce byte-identical outputs.

The PostgreSQL `make check` and `make check-world` exclusion ledger remains
the exact-revision capability policy in
`tests/postgres/postgres-test-capabilities.json`. New unsupported or blocked
rules require review and a supported failure always fails the gate.

## Universal wrapper contract

Generated wrappers expose one extension object with an exact, partial artifact
map. The `wasm32-initial` profile contains only `wasm32-classic` and
`wasm32-multi-memory`; absence never means that the loader may try a nearby
target. Ordinary application code is therefore unchanged:

```ts
const classic = await PGlite.create({ extensions: { vector } })
const postmaster = await PGlitePostmaster.create({
  dataDir: 'file:///var/lib/pglite',
  extensions: { vector },
})
```

The default generated URLs are suitable for package publication. A deployment
that moves assets can replace only their location while retaining all generated
identity and integrity metadata:

```ts
const db = await PGlite.create({
  extensions: { vector },
  locateExtensionArtifact: ({ descriptor }) =>
    new URL(descriptor.url.pathname, 'https://cdn.example.invalid/pglite/'),
})
```

`vector.configure({ locateArtifact })` applies the same location-only override
to one extension. `vector.configure({ artifact })` accepts a complete
descriptor for a custom build; its target, manifest, sizes, and hashes are
validated exactly like generated metadata. A bare URL cannot claim a new
target. Milestone A intentionally supports URL sources rather than unowned byte
arrays.

## Third-party build surface

The pinned tools image installs these commands:

- `pglite-transform-side-module`
- `pglite-package-extension`
- `pglite-generate-extension-wrapper`
- `pglite-build-initial-extension-artifacts`
- `pglite-validate-initial-extension-release`

They must be run in that image. A two-target release supplies a classic archive
tree and a shared-memory SIDE_MODULE archive tree to
`pglite-build-initial-extension-artifacts`; it transforms and audits the latter,
packages both deterministically, emits their descriptors, generates the static
wrapper map, and rejects an incomplete or over-budget release.
