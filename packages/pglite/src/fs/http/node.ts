import { HttpFsBase } from './base.js'
import { syncFetchNode } from '../../sync-fetch/node.js'

export class HttpFs extends HttpFsBase {
  fetch = syncFetchNode
}
