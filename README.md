# PGlite - Postgres in WASM

## Building

Prerequisites:

- postgres build toolchain
- emscripten/3.1.25
  `emsdk install 3.1.25 && emsdk activate 3.1.25`

Then run:

```
pnpm install
pnpm build
```