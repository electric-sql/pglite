
export const states = {
  IDLE: 0,
  CALL: 1,
  PROCESS: 2,
  RESPONSE: 3,
  // States for reading from a buffer via copy:
  READ_NEXT: 4,
  READ_READY: 5,
  READ_DONE: 6,
  // States for writing to a buffer via copy:
  WRITE_NEXT: 7,
  WRITE_READY: 8,
  WRITE_DONE: 9,
} as const;

export const slot = {
  STATE: 0,
  CALL_LENGTH: 1,
  RESPONSE_LENGTH: 2,
} as const;

export type FsStats = {
  dev: number;
  ino: number;
  mode: number;
  nlink: number;
  uid: number;
  gid: number;
  rdev: number;
  size: number;
  blksize: number;
  blocks: number;
  atime: number;
  mtime: number;
  ctime: number;
}

export interface CallMsg {
  type: string;
  args: any[];
}

export type ResponseJsonOk = {
  value: any;
}

export type ResponseJsonError = {
  error: {
    code: string;
    message: string;
  };
}

export type ResponseJson = ResponseJsonOk | ResponseJsonError;

export interface OpenFd {
  id: number;
  path: string;
  handle: FileSystemFileHandle;
  syncHandle: FileSystemSyncAccessHandle;
}

// TypeScript doesn't have a built-in type for FileSystemSyncAccessHandle
export interface FileSystemSyncAccessHandle {
  close(): void;
  flush(): void;
  getSize(): number;
  read(buffer: ArrayBuffer, options: { at: number }): number;
  truncate(newSize: number): void;
  write(buffer: ArrayBuffer, options: { at: number }): number;
}
