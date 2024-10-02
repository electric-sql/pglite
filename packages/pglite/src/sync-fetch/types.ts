export type SyncFetch = (
  url: string,
  range?: { start: number; end: number },
) => Uint8Array
