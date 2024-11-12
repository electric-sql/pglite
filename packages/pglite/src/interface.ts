import type {
  BackendMessage,
  NoticeMessage,
} from '@electric-sql/pg-protocol/messages'
import type { Filesystem } from './fs/base.js'
import type { DumpTarCompressionOptions } from './fs/tarUtils.js'
import type { Parser, Serializer } from './types.js'

export type FilesystemType = 'nodefs' | 'idbfs' | 'memoryfs'

export type DebugLevel = 0 | 1 | 2 | 3 | 4 | 5

export type RowMode = 'array' | 'object'

export interface ParserOptions {
  [pgType: number]: (value: string) => any
}

export interface SerializerOptions {
  [pgType: number]: (value: any) => string
}

export interface QueryOptions {
  rowMode?: RowMode
  parsers?: ParserOptions
  serializers?: SerializerOptions
  blob?: Blob | File
  onNotice?: (notice: NoticeMessage) => void
  paramTypes?: number[]
}

export interface ExecProtocolOptions {
  syncToFs?: boolean
  throwOnError?: boolean
  onNotice?: (notice: NoticeMessage) => void
}

export interface ExtensionSetupResult<TNamespace = any> {
  emscriptenOpts?: any
  namespaceObj?: TNamespace
  bundlePath?: URL
  init?: () => Promise<void>
  close?: () => Promise<void>
}

export type ExtensionSetup<TNamespace = any> = (
  pg: PGliteInterface,
  emscriptenOpts: any,
  clientOnly?: boolean,
) => Promise<ExtensionSetupResult<TNamespace>>

export interface Extension<TNamespace = any> {
  name: string
  setup: ExtensionSetup<TNamespace>
}

export type ExtensionNamespace<T> =
  T extends Extension<infer TNamespace> ? TNamespace : any

export type Extensions = {
  [namespace: string]: Extension | URL
}

export type InitializedExtensions<TExtensions extends Extensions = Extensions> =
  {
    [K in keyof TExtensions]: ExtensionNamespace<TExtensions[K]>
  }

export interface ExecProtocolResult {
  messages: BackendMessage[]
  data: Uint8Array
}

export interface DumpDataDirResult {
  tarball: Uint8Array
  extension: '.tar' | '.tgz'
  filename: string
}

export interface PGliteOptions<TExtensions extends Extensions = Extensions> {
  dataDir?: string
  username?: string
  database?: string
  fs?: Filesystem
  debug?: DebugLevel
  relaxedDurability?: boolean
  extensions?: TExtensions
  loadDataDir?: Blob | File
  initialMemory?: number
  wasmModule?: WebAssembly.Module
  fsBundle?: Blob | File
  parsers?: ParserOptions
  serializers?: SerializerOptions
}

export type PGliteInterface<T extends Extensions = Extensions> =
  InitializedExtensions<T> & {
    readonly waitReady: Promise<void>
    readonly debug: DebugLevel
    readonly ready: boolean
    readonly closed: boolean

    close(): Promise<void>
    query<T>(
      query: string,
      params?: any[],
      options?: QueryOptions,
    ): Promise<Results<T>>
    sql<T>(
      sqlStrings: TemplateStringsArray,
      ...params: any[]
    ): Promise<Results<T>>
    exec(query: string, options?: QueryOptions): Promise<Array<Results>>
    describeQuery(query: string): Promise<DescribeQueryResult>
    transaction<T>(
      callback: (tx: Transaction) => Promise<T>,
    ): Promise<T | undefined>
    execProtocolRaw(
      message: Uint8Array,
      options?: ExecProtocolOptions,
    ): Promise<Uint8Array>
    execProtocol(
      message: Uint8Array,
      options?: ExecProtocolOptions,
    ): Promise<ExecProtocolResult>
    listen(
      channel: string,
      callback: (payload: string) => void,
    ): Promise<() => Promise<void>>
    unlisten(
      channel: string,
      callback?: (payload: string) => void,
    ): Promise<void>
    onNotification(
      callback: (channel: string, payload: string) => void,
    ): () => void
    offNotification(callback: (channel: string, payload: string) => void): void
    dumpDataDir(compression?: DumpTarCompressionOptions): Promise<File | Blob>
  }

export type PGliteInterfaceExtensions<E> = E extends Extensions
  ? {
      [K in keyof E]: E[K] extends Extension
        ? Awaited<ReturnType<E[K]['setup']>>['namespaceObj'] extends infer N
          ? N extends undefined | null | void
            ? never
            : N
          : never
        : never
    }
  : Record<string, never>

export type Row<T = { [key: string]: any }> = T

export type Results<T = { [key: string]: any }> = {
  rows: Row<T>[]
  affectedRows?: number
  fields: { name: string; dataTypeID: number }[]
  blob?: Blob // Only set when a file is returned, such as from a COPY command
}

export interface Transaction {
  query<T>(
    query: string,
    params?: any[],
    options?: QueryOptions,
  ): Promise<Results<T>>
  sql<T>(
    sqlStrings: TemplateStringsArray,
    ...params: any[]
  ): Promise<Results<T>>
  exec(query: string, options?: QueryOptions): Promise<Array<Results>>
  rollback(): Promise<void>
  get closed(): boolean
}

export type DescribeQueryResult = {
  queryParams: { dataTypeID: number; serializer: Serializer }[]
  resultFields: { name: string; dataTypeID: number; parser: Parser }[]
}
