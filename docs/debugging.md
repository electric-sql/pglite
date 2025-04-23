### Debugging PGlite

Building a `debug` version of PGlite allows you to debug both the TypeScript and WASM parts of the project.

# Prerequisites

- Chrome browser
- [C/C++ DevTools Support (DWARF) Chrome extension](https://goo.gle/wasm-debugging-extension).
- Set `DEBUG=true` in `.buildconfig` file.

Everything needed to build a debug version of `pglite` comes preinstalled in the [docker image](https://hub.docker.com/r/electricsql/pglite-builder).

# Run the build

`./build-with-docker.sh`

This step will create a `pglite.wasm` build that contains the debug information. But since the build was done in docker, you need to adapt the file paths used. Follow [these instructions](https://developer.chrome.com/docs/devtools/wasm#map-path) and specify the mapping `/workspace` -> `your local folder` (e.g. `/workspace` -> `/home/me/pglite/postgres-pglite`).