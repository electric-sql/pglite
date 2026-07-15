export interface PGliteContractRequirement {
  readonly coreVersion: string
  readonly contract: 'node-network-host' | 'initdb-runtime'
  readonly abiVersion: number
}
