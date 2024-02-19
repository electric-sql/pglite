# PGlite - Postgres in WASM

## Building

Prerequisites:

- postgres build toolchain
- emscripten/3.1.0
  `emsdk install 3.1.0 && emsdk activate 3.1.0`

Then run:

```
pnpm install
pnpm build
```