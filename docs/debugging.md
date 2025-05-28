# Debugging PGlite

Building a `debug` version of PGlite allows you to debug both the TypeScript and WASM parts of the project.

You can run an interactive debug session either in Chrome or in Visual Studio Code.

## Using Visual Studio Code

### Prerequisites

- Visual Studio Code with [WebAssembly DWARF Debugging](https://marketplace.visualstudio.com/items?itemName=ms-vscode.wasm-dwarf-debugging) extension installed

## Using Chrome

### Prerequisites

- Chrome browser
- [C/C++ DevTools Support (DWARF) Chrome extension](https://goo.gle/wasm-debugging-extension).

# Running the DEBUG build

`$ pnpm build:all:debug`

This step will create a `pglite.wasm` build that contains the debug information as well as a non-minified version of the pglite javascript frontend. You can now use this build to run interactive debug sessions.

For example, you can start the `JavaScript Debug Terminal` inside VSCode and run some of the pglite tests. 

From the folder `packages/pglite`:

`$ vitest tests/basic.test.ts`
