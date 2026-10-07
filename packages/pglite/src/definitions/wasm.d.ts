// `?module` imports are resolved by unwasm (https://github.com/unjs/unwasm)
declare module '*.wasm?module' {
  const mod: WebAssembly.Module
  export default mod
}
