import type { BackendMessage } from "pg-protocol/dist/messages.js";

export type FilesystemType = "nodefs" | "idbfs" | "memoryfs";

export type DebugLevel = 0 | 1 | 2 | 3 | 4 | 5;

export type RowMode = "array" | "object";

export interface ParserOptions {
  [pgType: number]: (value: string) => any;
};

export interface QueryOptions {
  rowMode?: RowMode;
  parsers?: ParserOptions;
}

export interface PGliteOptions {
  debug?: DebugLevel;
}

export interface PGliteInterface {
  readonly dataDir?: string;
  readonly fsType: FilesystemType;
  readonly waitReady: Promise<void>;
  readonly debug: DebugLevel;
  readonly ready: boolean;
  readonly closed: boolean;

  close(): Promise<void>;
  query<T>(
    query: string,
    params?: any[],
    options?: QueryOptions
  ): Promise<Results<T>>;
  exec(query: string, options?: QueryOptions): Promise<Array<Results>>;
  transaction<T>(
    callback: (tx: Transaction) => Promise<T>
  ): Promise<T | undefined>;
  execProtocol(
    message: Uint8Array
  ): Promise<Array<[BackendMessage, Uint8Array]>>;
}

export type Row<T = { [key: string]: any }> = T;

export type Results<T = { [key: string]: any }> = {
  rows: Row<T>[];
  affectedRows?: number;
  fields: { name: string; dataTypeID: number }[];
};

export interface Transaction {
  query<T>(
    query: string,
    params?: any[],
    options?: QueryOptions
  ): Promise<Results<T>>;
  exec(query: string, options?: QueryOptions): Promise<Array<Results>>;
  rollback(): Promise<void>;
  get closed(): boolean;
}
