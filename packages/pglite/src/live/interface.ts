import type { Results } from "../interface";

export interface LiveNamespace {
  /**
   * Create a live query
   * @param query - The query to run
   * @param params - The parameters to pass to the query
   * @param callback - A callback to run when the query is updated
   * @returns A promise that resolves to an object with the initial results,
   * an unsubscribe function, and a refresh function
   */
  query<T = { [key: string]: any }>(
    query: string,
    params: any[] | undefined | null,
    callback: (results: Results<T>) => void,
  ): Promise<LiveQueryReturn<T>>;

  /**
   * Create a live query that returns the changes to the query results
   * @param query - The query to run
   * @param params - The parameters to pass to the query
   * @param callback - A callback to run when the query is updated
   * @returns A promise that resolves to an object with the initial changes,
   * an unsubscribe function, and a refresh function
   */
  changes<T = { [key: string]: any }>(
    query: string,
    params: any[] | undefined | null,
    key: string,
    callback: (changes: Array<Change<T>>) => void,
  ): Promise<LiveChangesReturn<T>>;

  /**
   * Create a live query with incremental updates
   * @param query - The query to run
   * @param params - The parameters to pass to the query
   * @param callback - A callback to run when the query is updated
   * @returns A promise that resolves to an object with the initial results,
   * an unsubscribe function, and a refresh function
   */
  incrementalQuery<T = { [key: string]: any }>(
    query: string,
    params: any[] | undefined | null,
    key: string,
    callback: (results: Results<Change<T>>) => void,
  ): Promise<LiveQueryReturn<Change<T>>>;
}

export interface LiveQueryReturn<T> {
  initialResults: Results<T>;
  unsubscribe: () => Promise<void>;
  refresh: () => Promise<void>;
}

export interface LiveChangesReturn<T = { [key: string]: any }> {
  fields: { name: string; dataTypeID: number }[];
  initialChanges: Array<Change<T>>;
  unsubscribe: () => Promise<void>;
  refresh: () => Promise<void>;
}

export type ChangeInsert<T> = {
  __changed_columns__: string[];
  __op__: "INSERT";
  __after__: number;
} & T;

export type ChangeDelete<T> = {} & {
  __changed_columns__: string[];
  __op__: "DELETE";
  __after__: undefined;
} & T;

export type ChangeUpdate<T> = {} & {
  __changed_columns__: string[];
  __op__: "UPDATE";
  __after__: number;
} & T;

export type ChangeReset<T> = {
  __op__: "RESET";
} & T;

export type Change<T> =
  | ChangeInsert<T>
  | ChangeDelete<T>
  | ChangeUpdate<T>
  | ChangeReset<T>;
