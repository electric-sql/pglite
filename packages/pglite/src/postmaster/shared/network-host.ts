export interface PostgresHostBindRequest {
  readonly listenerId: number
  readonly generation: number
  readonly transport: 'tcp' | 'unix'
  readonly host?: string
  readonly port?: number
  readonly path?: string
  /** PostgreSQL's resolved unix_socket_permissions value. */
  readonly unixMode?: number
  /** PostgreSQL's resolved unix_socket_group value. */
  readonly unixGroup?: string
}

export interface PostgresNodeNetworkHost {
  bind(request: PostgresHostBindRequest): Promise<void>
  listen(listenerId: number, generation: number, backlog: number): Promise<void>
  close(listenerId: number, generation: number): Promise<void>
}

export type PostgresSocketAddress =
  | {
      readonly transport: 'tcp'
      readonly host: string
      readonly port: number
    }
  | {
      readonly transport: 'unix'
      readonly path: string
    }

export interface PostgresSocketOperationResponse {
  readonly buffer: SharedArrayBuffer
}

export interface PostgresSocketBindOperation {
  readonly type: 'network-bind'
  readonly pid: number
  readonly generation: number
  readonly descriptor: number
  readonly address: PostgresSocketAddress
  readonly response: PostgresSocketOperationResponse
}

export interface PostgresSocketListenOperation {
  readonly type: 'network-listen'
  readonly pid: number
  readonly generation: number
  readonly descriptor: number
  readonly listenerId: number
  readonly listenerGeneration: number
  readonly backlog: number
  readonly response: PostgresSocketOperationResponse
}

export interface PostgresSocketConfigureUnixOperation {
  readonly type: 'network-configure-unix'
  readonly pid: number
  readonly generation: number
  readonly descriptor: number
  readonly listenerId: number
  readonly listenerGeneration: number
  readonly path: string
  readonly mode: number
  readonly group: string
  readonly response: PostgresSocketOperationResponse
}

export interface PostgresSocketCloseOperation {
  readonly type: 'network-close'
  readonly pid: number
  readonly generation: number
  readonly descriptor: number
  readonly listenerId: number
  readonly listenerGeneration: number
  readonly response: PostgresSocketOperationResponse
}

export type PostgresSocketOperation =
  | PostgresSocketBindOperation
  | PostgresSocketConfigureUnixOperation
  | PostgresSocketListenOperation
  | PostgresSocketCloseOperation

export const NETWORK_RESPONSE_WORDS = 4
export const NETWORK_RESPONSE_STATE = 0
export const NETWORK_RESPONSE_ERRNO = 1
export const NETWORK_RESPONSE_LISTENER_ID = 2
export const NETWORK_RESPONSE_GENERATION = 3
