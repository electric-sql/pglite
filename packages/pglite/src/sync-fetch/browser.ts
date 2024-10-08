import type { SyncFetch } from './types.js'

/**
 * Sync fetch function for browser using XMLHttpRequest
 */
export const syncFetchBrowser: SyncFetch = (
  url: string,
  range?: { start: number; end: number },
): Uint8Array => {
  const xhr = new XMLHttpRequest()
  xhr.open('GET', url, false)
  if (range) {
    xhr.setRequestHeader('Range', `bytes=${range.start}-${range.end}`)
  }
  xhr.responseType = 'arraybuffer'
  xhr.send(null)
  if (xhr.status !== 200 && xhr.status !== 206) {
    throw new Error('Failed to load file')
  }
  return new Uint8Array(xhr.response)
}
