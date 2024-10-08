import { HttpFsBase } from './base.js'
import { syncFetchBrowser } from '../../sync-fetch/browser.js'

export class HttpFs extends HttpFsBase {
  fetch = syncFetchBrowser
}
