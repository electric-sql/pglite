export interface NativeToolWorkerData {
  readonly command: string
  readonly argv: readonly string[]
  readonly env: Readonly<Record<string, string | undefined>>
  readonly cwd?: string
  readonly moduleUrl: string
}

export interface SocketAddress {
  readonly transport: 'tcp' | 'unix'
  readonly host?: string
  readonly port?: number
  readonly path?: string
}

export interface PollDescriptor {
  readonly descriptor: number
  readonly events: number
}

export type NativeToolWorkerMessage =
  | {
      readonly type: 'stdin'
      readonly response: SharedArrayBuffer
    }
  | {
      readonly type: 'stdout' | 'stderr'
      readonly data: Uint8Array
      readonly response: SharedArrayBuffer
    }
  | {
      readonly type: 'socket-connect'
      readonly descriptor: number
      readonly address: SocketAddress
      readonly response: SharedArrayBuffer
    }
  | {
      readonly type: 'socket-send'
      readonly descriptor: number
      readonly data: Uint8Array
      readonly response: SharedArrayBuffer
    }
  | {
      readonly type: 'socket-receive'
      readonly descriptor: number
      readonly maximum: number
      readonly response: SharedArrayBuffer
    }
  | {
      readonly type: 'socket-poll'
      readonly descriptors: readonly PollDescriptor[]
      readonly timeout: number
      readonly response: SharedArrayBuffer
    }
  | {
      readonly type: 'socket-close'
      readonly descriptor: number
      readonly response: SharedArrayBuffer
    }
  | { readonly type: 'result'; readonly exitCode: number }
  | {
      readonly type: 'error'
      readonly message: string
      readonly stack?: string
    }

export const RESPONSE_STATE = 0
export const RESPONSE_STATUS = 1
export const RESPONSE_LENGTH = 2
export const RESPONSE_HEADER_WORDS = 3
export const RESPONSE_CHUNK_BYTES = 64 * 1024
