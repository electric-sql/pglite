# Extension Development

PGlite has support for both Postgres extensions, and has its own plugin API that allows a developer to augment a PGlite instance with an additional API.

## Extension API

::: warning
The extension API is not yet stable and may change in a future release.
:::

PGlite extensions are an object with the following interface:

```ts
export interface Extension {
  name: string
  setup: ExtensionSetup
}

export type ExtensionSetup = (
  pg: PGliteInterface,
  emscriptenOpts: any,
  clientOnly?: boolean,
) => Promise<ExtensionSetupResult>

export interface ExtensionSetupResult {
  emscriptenOpts?: any
  namespaceObj?: any
  bundlePath?: URL
  init?: () => Promise<void>
  close?: () => Promise<void>
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

In PGlite, every Postgres extension consists of two parts: a **backend** part, and a **frontend** part. The backend part is its core code. The frontend part is the `typescript/javascript` code that interacts with PGlite.

### Happy path

Some extensions are (much) easier to build and integrate with PGlite than others. This section describes the process of porting a Postgres extension that has no external dependencies besides the already build ones for PGlite (see builder/Dockerfile).

Clone **PGlite's** entire repo, including submodules and install the necessary dependencies:

```
$ git clone --recurse-submodules git@github.com:electric-sql/pglite.git
$ cd pglite
$ pnpm i
```

and create a new branch to track your work:

```
$ git checkout -b myghname/myawesomeextension
```

#### Happy path - backend part

PGlite's backend code is in the repo [postgres-pglite](https://github.com/electric-sql/postgres-pglite) and is downloaded as a submodule dependency of the main repo. You will add your extension's code as a new submodule dependency:

```
$ cd postgres-pglite/pglite
$ git submodule add <myawesomeextension_url>
```

This **should** create a new folder `postgres-pglite/pglite/myawesomeextension` where the extension code has been downloaded. Check it:

```
$ ls -lah myawesomeextension
<the extension files should be listed here>
```

Now append the **folder name** to `SUBDIRS` inside `postgres-pglite/pglite/Makefile`:

```
SUBDIRS = \
		pg_ivm \
		vector \
    myawesomeextension
```

These steps allow our build environment to pick up the extension's code, then build and package it for PGlite. The backend build process will output a `myawesomeextension.tar.gz` containing the WASM code and/or any data dependencies of the extension.

#### Happy path - frontend part

PGlite's frontend code is in the main [PGLite repo](https://github.com/electric-sql/pglite)

Create a new folder `packages/pglite/src/myawesomeextension` and a new file inside it `index.ts`. This is how PGlite will know how to load your new extension:

```
import type {
  Extension,
  ExtensionSetupResult,
  PGliteInterface,
} from '../interface'

const setup = async (_pg: PGliteInterface, emscriptenOpts: any) => {
  return {
    emscriptenOpts,
    bundlePath: new URL('../../release/myawesomeextension.tar.gz', import.meta.url),
  } satisfies ExtensionSetupResult
}

export const myawesomeextension = {
  name: 'myawesomeextension',
  setup,
} satisfies Extension

```

Now add the extension to `packages/pglite/package.json` exports:

```
 "exports": {
  ...
    "./myawesomeextension": {
      "import": {
        "types": "./dist/myawesomeextension/index.d.ts",
        "default": "./dist/myawesomeextension/index.js"
      },
      "require": {
        "types": "./dist/myawesomeextension/index.d.cts",
        "default": "./dist/myawesomeextension/index.cjs"
      }
    },
}
```

Open `packages/pglite/tsup.config.ts` and add your extension inside `entryPoints`:

```
const entryPoints = [
  ...
  'src/myawesomeextension/index.ts'
]
```

You also need to add the extension to `packages/pglite/scripts/bundle-wasm.ts`, inside `main()`:

```
async function main() {
 ...
 await findAndReplaceInDir('./dist/myawesomeextension', /\.\.\/release\//g, '', [
    '.js',
    '.cjs',
  ])
}

```

Finally, add the extension description to `docs/extensions/extensions.data.ts`, inside `baseExtensions`:

```
const baseExtensions: Extension[] = [
...
{
    name: 'My awesome Postgres extension',
    description: `
    My awesome Postgres extension is something that the world has never seen before.
    `,
    shortDescription:
      'My awesome PostgreSQL extension',
    docs: 'https://github.com/myawesomeextension/extension',
    tags: ['postgres extension'],
    importPath: '@electric-sql/pglite/myawesomeextension',
    importName: 'my_awesome_extension',
    size: 123456,
},
]
```

#### Happy path: add tests

To make sure that your extension works, you need to add some tests for it. We use [vitest](https://vitest.dev/). They will be run as part of our CI/CD pipeline.
Add a file `packages/pglite/tests/myawesomeextension.test.ts` and write there your tests. Have a look inside that folder `packages/pglite/tests` at other tests to get an idea how they work.

#### Happy path: build and run tests

From PGlite's base folder:

```
$ pnpm build:all
```

This will build **everything**, including your new extension. If there are no errors, you are ready to run the tests!

```
$ cd packages/pglite
$ pnpm test
```

Fix any errors that occur, re-run the tests! Iterate until everything works as expected.

#### Happy path: open a PR

We welcome contributions! Open a PR so anyone using PGlite can also use your extension!

#### Further tips and tricks

If you get stuck, have a look at how other Postgres extensions are build for PGlite. Take a look at `pg_ivm`, `pgvector` or `pgtap`. You can also reach out on [Discord](https://discord.com/channels/933657521581858818/1212676471588520006) for help!

### Unhappy path

This section is still under development.

As mentioned before, some extensions require more effort to integrate with PGlite. Usually the difficulties arrise from the fact that the extension itself has dependencies that need to be compiled for WASM, which in turn might have other dependencies that need to be compiled for WASM and so on. The entire chain of dependencies needs to be built for WASM.

Another source of pain for building an extension is the need to export symbols from the dependencies or from PGlite itself. Sometimes these are obvious only at runtime.

We are still working on documentation and examples showing how to build more complex Postgres extensions for use with PGlite. Please check back soon, or reach out on [Discord](https://discord.com/channels/933657521581858818/1212676471588520006) if you would like to try building a particular extension for PGlite.
