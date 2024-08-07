# Extension Development

PGlite has support for both Postgres extensions, and has its own plugin API that allows a developer to augment a PGlite instance with an additional API.

## Extension API

::: warning
The extension API is not yet stable and may change in a future release.
:::

PGlite extensions are an object with the following interface:

```ts
export interface Extension {
  name: string;
  setup: ExtensionSetup;
}

export type ExtensionSetup = (
  pg: PGliteInterface,
  emscriptenOpts: any,
  clientOnly?: boolean,
) => Promise<ExtensionSetupResult>;

export interface ExtensionSetupResult {
  emscriptenOpts?: any;
  namespaceObj?: any;
  bundlePath?: URL;
  init?: () => Promise<void>;
  close?: () => Promise<void>;
}
```

`name` is the human readable name of the extension.

`setup` is a function that receives the following parameters, and returns a promise that resolves to an object conforming to `ExtensionSetupResult`:

- `pg`<br>
  The [PGlite](../docs/api.md) instance that the extension is being added to
- `emscriptenOpts`<br>
  The options currently configured to pass to the [Emscrption Module factory](https://emscripten.org/docs/api_reference/module.html), including the [Emscript FS](https://emscripten.org/docs/api_reference/Filesystem-API.html).
- `clientOnly`<br>
  A boolean indicating if this instance of the extension is "client only", meaning that it is on the main thread and doesn't have direct access to the underlying WASM as it is running in a worker. When true, `emscriptenOpts` and `bundlePath` should not re returned as they will have no effect.

The returned object has these properties - all are optional:

- `emscriptenOpts`<br>
  Any augmented or altered configuration to pass to the [Emscrption Module factory](https://emscripten.org/docs/api_reference/module.html).
- `namespaceObj`<br>
  An object to add as a namespace to the PGlite instance; this can provide access to additional methods or properties that your extension would like to expose.
- `bundlePath`<br>
  The path to the Postgres extension tarball - see [Building Postgres Extensions](#building-postgres-extensions)
- `init`<br>
  An initialisation function that will be run after the PGlite instance and Postgres runtime has started, but before the instance is marked as ready for external usage. You can use this to perform any initialisation your extension needs to perform on the database at startup.
- `close`<br>
  A function that will be called when the user calls `close()` on their PGlite instance; this is called before the database has been shut down.

An example of a PGlite extension that augments the PGlite instance is the [live query extension](../docs/live-queries.md).

## Building Postgres Extensions

We are still working on documentation and examples showing how to build Postgres extensions for use with PGlite. Please check back soon, or reach out on [Discord](https://discord.com/channels/933657521581858818/1212676471588520006) if you would like to try building a particular extension for PGlite.
