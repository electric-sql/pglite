# PGlite React.js Hooks

This package implements React hooks for [PGLite](https://pglite.dev/) on top of the [live query plugin](https://pglite.dev/docs/live-queries). Full documentation is available at [pglite.dev/docs/framework-hooks](https://pglite.dev/docs/framework-hooks#react).

To install:

```sh
npm install @electric-sql/pglite-react
```

The hooks this package provides are:

- [PGliteProvider](https://pglite.dev/docs/framework-hooks#pgliteprovider): A Provider component to pass a PGlite instance to all child components for use with the other hooks.
- [usePGlite](https://pglite.dev/docs/framework-hooks#usepglite): Retrieve the provided PGlite instance.
- [useLiveQuery](https://pglite.dev/docs/framework-hooks#uselivequery): Reactively re-render your component whenever the results of a live query change
- [useLiveIncrementalQuery](https://pglite.dev/docs/framework-hooks#useliveincrementalquery): Reactively re-render your component whenever the results of a live query change by offloading the diff to PGlite
