// RN entrypoint exports the same API as @electric-sql/pglite,
// but uses a native-backed adapter under the hood for execProtocol.
export * from '@electric-sql/pglite'
export { PGliteReactNative as PGlite } from './adapter'
