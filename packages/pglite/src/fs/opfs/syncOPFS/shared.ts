import { buffer } from "stream/consumers";

export const states = {
  IDLE: 0,
  CALL: 1,
  PROCESS: 2,
  RESPONSE: 3,
  ASK_NEXT: 4,
  SEND_NEXT: 5,
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
};

export interface CallMsg {
  method: string;
  args: any[];
}

export type ResponseJsonOk = {
  value: any;
};

export type ResponseJsonError = {
  error: {
    code: number;
    message: string;
  };
};

export type ResponseJson = ResponseJsonOk | ResponseJsonError;

export interface OpenFd {
  id: number;
  path: string;
  handle: FileSystemFileHandle;
  syncHandle: FileSystemSyncAccessHandle;
  ref: number; // reference count
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

export function waitFor(
  typedArray: Int32Array,
  index: number,
  value: number | number[],
): number {
  while (true) {
    const state = Atomics.load(typedArray, index);
    if (state === value || (Array.isArray(value) && value.includes(state))) {
      return state;
    }
    Atomics.wait(typedArray, index, state);
  }
}

export const ERRNO_CODES = {
  ENODEV: 43,
  ENOENT: 44,
  EINVAL: 28,
} as const;

export class FsError extends Error {
  code?: number;
  constructor(code: number | keyof typeof ERRNO_CODES | null, message: string) {
    super(message);
    if (typeof code === "number") {
      this.code = code;
    } else if (typeof code === "string") {
      this.code = ERRNO_CODES[code];
    }
  }
}
