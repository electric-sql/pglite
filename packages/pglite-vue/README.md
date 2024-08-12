# PGlite Vue.js Bindings

This package implements Vue.js hooks for [PGLite](https://pglite.dev/) on top of the [live query plugin](https://pglite.dev/docs/live-queries). Full documentation is available at [pglite.dev/docs/framework-hooks](https://pglite.dev/docs/framework-hooks#react).

To install:

```sh
npm install @electric-sql/pglite-vue
```

The hooks this package provides are:

- [proidePGlite](https://pglite.dev/docs/framework-hooks#providepglite): Provide a PGlite instance to all child components.
- [injectPGlite](https://pglite.dev/docs/framework-hooks#injectpglite): Retrieve the provided PGlite instance.
- [useLiveQuery](https://pglite.dev/docs/framework-hooks#uselivequery): Reactively receive results of a live query change
- [useLiveIncrementalQuery](https://pglite.dev/docs/framework-hooks#useliveincrementalquery): Reactively receive results of a live query change by offloading the diff to PGlite
