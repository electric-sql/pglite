import type {
  BackendMessage,
  NoticeMessage,
} from "pg-protocol/src/messages.js";
import type { Filesystem } from "./fs/types.js";

export type FilesystemType = "nodefs" | "idbfs" | "memoryfs";

export type DebugLevel = 0 | 1 | 2 | 3 | 4 | 5;

export type RowMode = "array" | "object";

export interface ParserOptions {
  [pgType: number]: (value: string) => any;
}

export interface QueryOptions {
  rowMode?: RowMode;
  parsers?: ParserOptions;
  blob?: Blob | File;
  onNotice?: (notice: NoticeMessage) => void;
}

export interface ExecProtocolOptions {
  syncToFs?: boolean;
  onNotice?: (notice: NoticeMessage) => void;
}

export interface ExtensionSetupResult {
  emscriptenOpts?: any;
  namespaceObj?: any;
  bundlePath?: URL;
  init?: () => Promise<void>;
  close?: () => Promise<void>;
}

export type ExtensionSetup = (
  pg: PGliteInterface,
  emscriptenOpts: any,
  clientOnly?: boolean,
) => Promise<ExtensionSetupResult>;

export interface Extension {
  name: string;
  setup: ExtensionSetup;
}

export type Extensions = {
  [namespace: string]: Extension | URL;
};

export interface DumpDataDirResult {
  tarball: Uint8Array;
  extension: ".tar" | ".tgz";
  filename: string;
}

export interface PGliteOptions {
  dataDir?: string;
  username?: string;
  dbname?: string;
  fs?: Filesystem;
  debug?: DebugLevel;
  relaxedDurability?: boolean;
  extensions?: Extensions;
  loadDataDir?: Blob | File;
}

export type PGliteInterface = {
  readonly waitReady: Promise<void>;
  readonly debug: DebugLevel;
  readonly ready: boolean;
  readonly closed: boolean;

  close(): Promise<void>;
  query<T>(
    query: string,
    params?: any[],
    options?: QueryOptions,
  ): Promise<Results<T>>;
  exec(query: string, options?: QueryOptions): Promise<Array<Results>>;
  transaction<T>(
    callback: (tx: Transaction) => Promise<T>,
  ): Promise<T | undefined>;
  execProtocolRaw(
    message: Uint8Array,
    options?: ExecProtocolOptions,
  ): Promise<Uint8Array>;
  execProtocol(
    message: Uint8Array,
    options?: ExecProtocolOptions,
  ): Promise<Array<[BackendMessage, Uint8Array]>>;
  listen(
    channel: string,
    callback: (payload: string) => void,
  ): Promise<() => Promise<void>>;
  unlisten(
    channel: string,
    callback?: (payload: string) => void,
  ): Promise<void>;
  onNotification(
    callback: (channel: string, payload: string) => void,
  ): () => void;
  offNotification(callback: (channel: string, payload: string) => void): void;
  dumpDataDir(): Promise<File | Blob>;
};

export type PGliteInterfaceExtensions<E> = E extends Extensions
  ? {
      [K in keyof E]: E[K] extends Extension
        ? Awaited<ReturnType<E[K]["setup"]>>["namespaceObj"] extends infer N
          ? N extends undefined | null | void
            ? never
            : N
          : never
        : never;
    }
  : {};

export type Row<T = { [key: string]: any }> = T;

export type Results<T = { [key: string]: any }> = {
  rows: Row<T>[];
  affectedRows?: number;
  fields: { name: string; dataTypeID: number }[];
  blob?: Blob; // Only set when a file is returned, such as from a COPY command
};

export interface Transaction {
  query<T>(
    query: string,
    params?: any[],
    options?: QueryOptions,
  ): Promise<Results<T>>;
  exec(query: string, options?: QueryOptions): Promise<Array<Results>>;
  rollback(): Promise<void>;
  get closed(): boolean;
}
