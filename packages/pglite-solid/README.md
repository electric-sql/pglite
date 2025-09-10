# PGlite Solidjs Hooks

This package implements Solid hooks for [PGLite](https://pglite.dev/) on top of the [live query plugin](https://pglite.dev/docs/live-queries). Full documentation is available at [pglite.dev/docs/framework-hooks](https://pglite.dev/docs/framework-hooks#solid).

To install:

```sh
npm install @electric-sql/pglite-solid
```

The hooks this package provides are:

- [PGliteProvider](https://pglite.dev/docs/framework-hooks/solid#pgliteprovider): A Provider component to pass a PGlite instance to all child components for use with the other hooks.
- [usePGlite](https://pglite.dev/docs/framework-hooks/solid#usepglite): Retrieve the provided PGlite instance.
- [makePGliteProvider](https://pglite.dev/docs/framework-hooks/solid#makepgliteprovider): Create typed instances of `PGliteProvider` and `usePGlite`.
- [useLiveQuery](https://pglite.dev/docs/framework-hooks/solid#uselivequery): Reactively re-render your component whenever the results of a live query change
- [useLiveIncrementalQuery](https://pglite.dev/docs/framework-hooks/solid#useliveincrementalquery): Reactively re-render your component whenever the results of a live query change by offloading the diff to PGlite
