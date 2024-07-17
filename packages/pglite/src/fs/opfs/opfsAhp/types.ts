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

// TypeScript doesn't have a built-in type for FileSystemSyncAccessHandle
export interface FileSystemSyncAccessHandle {
  close(): void;
  flush(): void;
  getSize(): number;
  read(buffer: ArrayBuffer, options: { at: number }): number;
  truncate(newSize: number): void;
  write(buffer: ArrayBuffer, options: { at: number }): number;
}

export const ERRNO_CODES = {
  EBADF: 8,
  EBADFD: 127,
  EEXIST: 20,
  EINVAL: 28,
  EISDIR: 31,
  ENODEV: 43,
  ENOENT: 44,
  ENOTDIR: 54,
  ENOTEMPTY: 55,
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

// State

export interface State {
  root: DirectoryNode;
  pool: PoolFilenames;
}

export type PoolFilenames = Array<string>;

// WAL

export interface WALEntry {
  opp: string;
  args: any[];
}

// Node tree

export type NodeType = "file" | "directory";

interface BaseNode {
  type: NodeType;
  lastModified: number;
  mode: number;
}

export interface FileNode extends BaseNode {
  type: "file";
  backingFilename: string;
}

export interface DirectoryNode extends BaseNode {
  type: "directory";
  children: { [filename: string]: Node };
}

export type Node = FileNode | DirectoryNode;
