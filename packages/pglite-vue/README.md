# PGlite Vue Bindings

This package implements Vue hooks for [PGLite](https://pglite.dev/) on top of the [live query plugin](https://pglite.dev/docs/live-queries). Full documentation is available at [pglite.dev/docs/framework-hooks/vue](https://pglite.dev/docs/framework-hooks/vue).

To install:

```sh
npm install @electric-sql/pglite-vue
```

The hooks this package provides are:

- [providePGlite](https://pglite.dev/docs/framework-hooks/vue#providepglite): Provide a PGlite instance to all child components.
- [injectPGlite](https://pglite.dev/docs/framework-hooks/vue#injectpglite): Retrieve the provided PGlite instance.
- [makePGliteDependencyInjector](https://pglite.dev/docs/framework-hooks/vue#makepglitedependencyinjector): Utility to create a typed version of `providePGlite` and `injectPGlite`.
- [useLiveQuery](https://pglite.dev/docs/framework-hooks/vue#uselivequery): Reactively receive results of a live query change
- [useLiveIncrementalQuery](https://pglite.dev/docs/framework-hooks/vue#useliveincrementalquery): Reactively receive results of a live query change by offloading the diff to PGlite
