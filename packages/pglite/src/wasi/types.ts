export interface WASIOptions {
  args?: string[]
  env?: Record<string, string>
  fs?: FSInterface
  debug?: boolean
}

export interface FSInterface {
  appendFileSync: (
    path: string,
    data: Uint8Array | string,
    options?: any,
  ) => void
  fsyncSync: (fd: number | string) => void
  linkSync: (existingPath: string, newPath: string) => void
  mkdirSync: (path: string, options?: any) => void
  readdirSync: (path: string, options?: any) => any[]
  readFileSync: (path: string, options?: any) => Uint8Array
  readlinkSync: (path: string, options?: any) => string
  renameSync: (oldPath: string, newPath: string) => void
  rmdirSync: (path: string, options?: any) => void
  setFlagsSync?: (path: string, flags: number) => void
  statSync: (path: string, options?: any) => any
  symlinkSync: (target: string, path: string, type?: string) => void
  truncateSync: (path: string, len?: number) => void
  unlinkSync: (path: string) => void
  utimesSync: (path: string, atime: number, mtime: number) => void
  writeFileSync: (
    path: string,
    data: Uint8Array | string,
    options?: any,
  ) => void
}

export interface FileDescriptorStdio {
  type: 'stdio'
  fd: 0 | 1 | 2
  preopenPath?: string
  append?: boolean
}

export interface FileDescriptorFile {
  type: 'file'
  fd: Exclude<number, 0 | 1 | 2 | 3>
  handle: {
    path: string
    position: number
  }
  preopenPath?: string
  append?: boolean
}

export interface FileDescriptorDirectory {
  type: 'directory'
  fd: Exclude<number, 0 | 1 | 2>
  handle: {
    path: string
  }
  preopenPath?: string
  append?: boolean
}

export type FileDescriptor =
  | FileDescriptorStdio
  | FileDescriptorFile
  | FileDescriptorDirectory
