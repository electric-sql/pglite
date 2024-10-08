import { syncFetchBrowser } from './browser.js'
import type { SyncFetch } from './types.js'
import { IN_NODE } from '../utils.js'

export type { SyncFetch } from './types.js'
/**
 * Creates a sync fetch function for the current environment
 */
export async function makeSyncFetch(): Promise<SyncFetch> {
  if (IN_NODE) {
    const { syncFetchNode } = await import('./node.js')
    return syncFetchNode
  } else {
    return syncFetchBrowser
  }
}
