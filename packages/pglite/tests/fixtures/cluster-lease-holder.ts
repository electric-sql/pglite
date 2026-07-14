import { NodeClusterLeaseProvider } from '../../src/fs/node-cluster-lease.js'

const dataDir = process.argv[2]
if (!dataDir) throw new Error('missing data directory')

const provider = new NodeClusterLeaseProvider()
await provider.acquireExclusiveClusterLease(dataDir, {
  ownerToken: process.argv[3] ?? 'child-owner',
  runtime: 'classic',
  startedAt: new Date().toISOString(),
})

process.send?.('ready')
setInterval(() => {}, 60_000)
