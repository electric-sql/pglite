import { FsError } from "./types.js";
import type {
  FsStats,
  State,
  FileSystemSyncAccessHandle,
  Node,
  FileNode,
  DirectoryNode,
  WALEntry,
} from "./types.js";

const STATE_FILE = "state.txt";
const DATA_DIR = "data";
const INITIAL_MODE = {
  DIR: 16384,
  FILE: 32768,
};

export interface OpfsAhpOptions {
  root: string;
  initialPoolSize?: number;
  maintainedPoolSize?: number;
}

/**
 * An OPFS Access Handle Pool VFS that exports a Node.js-like FS interface.
 * This FS is then wrapped by an Emscripten FS interface in emscriptenFs.ts.
 */
export class OpfsAhp {
  readyPromise: Promise<void>;
  #ready = false;

  readonly root: string;
  readonly initialPoolSize: number;
  readonly maintainedPoolSize: number;

  #opfsRootAh!: FileSystemDirectoryHandle;
  #rootAh!: FileSystemDirectoryHandle;
  #dataDirAh!: FileSystemDirectoryHandle;

  #stateFH!: FileSystemFileHandle;
  #stateSH!: FileSystemSyncAccessHandle;

  #fh: Map<string, FileSystemFileHandle> = new Map();
  #sh: Map<string, FileSystemSyncAccessHandle> = new Map();

  #handleIdCounter = 0;
  #openHandlePaths: Map<number, string> = new Map();
  #openHandleIds: Map<string, number> = new Map();

  state!: State;
  lastCheckpoint = 0;
  checkpointInterval = 1000 * 60; // 1 minute
  poolCounter = 0;

  #unsyncedSH = new Set<FileSystemSyncAccessHandle>();

  constructor({ root, initialPoolSize, maintainedPoolSize }: OpfsAhpOptions) {
    this.root = root;
    this.initialPoolSize = initialPoolSize || 1000;
    this.maintainedPoolSize = maintainedPoolSize || 100;
    this.readyPromise = this.#init();
  }

  static async create(options: OpfsAhpOptions) {
    const instance = new OpfsAhp(options);
    await instance.readyPromise;
    return instance;
  }

  async #init() {
    this.#opfsRootAh = await navigator.storage.getDirectory();
    this.#rootAh = await this.#resolveOpfsDirectory(this.root, {
      create: true,
    });
    this.#dataDirAh = await this.#resolveOpfsDirectory(DATA_DIR, {
      from: this.#rootAh,
      create: true,
    });

    this.#stateFH = await this.#rootAh.getFileHandle(STATE_FILE, {
      create: true,
    });
    this.#stateSH = await (this.#stateFH as any).createSyncAccessHandle();

    const stateAB = new ArrayBuffer(this.#stateSH.getSize());
    this.#stateSH.read(stateAB, { at: 0 });
    let state: State;
    const stateLines = new TextDecoder().decode(stateAB).split("\n");
    // Line 1 is a base state object.
    // Lines 1+n are WAL entries.

    let isNewState = false;
    try {
      state = JSON.parse(stateLines[0]);
    } catch (e) {
      state = {
        root: {
          type: "directory",
          lastModified: Date.now(),
          mode: INITIAL_MODE.DIR,
          children: {},
        },
        pool: [],
      };
      // write new state to file
      this.#stateSH.truncate(0);
      this.#stateSH.write(new TextEncoder().encode(JSON.stringify(state)), {
        at: 0,
      });
      isNewState = true;
    }
    this.state = state;

    // Apply WAL entries
    const wal = stateLines
      .slice(1)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    for (const entry of wal) {
      const methodName = `_${entry.opp}State`;
      if (typeof this[methodName as keyof this] === "function") {
        try {
          (this[methodName as keyof this] as any)(...entry.args);
        } catch (e) {
          console.warn("Error applying OPFS AHP WAL entry", entry, e);
        }
      }
    }

    // Open all file handles for dir tree
    const walkPromises: Promise<void>[] = [];
    const walk = async (node: Node) => {
      if (node.type === "file") {
        try {
          const fh = await this.#dataDirAh.getFileHandle(node.backingFilename);
          const sh: FileSystemSyncAccessHandle = await (
            fh as any
          ).createSyncAccessHandle();
          this.#fh.set(node.backingFilename, fh);

          this.#sh.set(node.backingFilename, sh);
        } catch (e) {
          console.error("Error opening file handle for node", node, e);
        }
      } else {
        for (const child of Object.values(node.children)) {
          walkPromises.push(walk(child));
        }
      }
    };
    await walk(this.state.root);

    // Open all pool file handles
    const poolPromises: Promise<void>[] = [];
    for (const filename of this.state.pool) {
      poolPromises.push(
        new Promise<void>(async (resolve) => {
          if (this.#fh.has(filename)) {
            console.warn("File handle already exists for pool file", filename);
          }
          const fh = await this.#dataDirAh.getFileHandle(filename);
          const sh: FileSystemSyncAccessHandle = await (
            fh as any
          ).createSyncAccessHandle();
          this.#fh.set(filename, fh);
          this.#sh.set(filename, sh);
          resolve();
        }),
      );
    }

    await Promise.all([...walkPromises, ...poolPromises]);

    await this.maintainPool(
      isNewState ? this.initialPoolSize : this.maintainedPoolSize,
    );

    this.#ready = true;
  }

  get ready() {
    return this.#ready;
  }

  async maintainPool(size?: number) {
    size = size || this.maintainedPoolSize;
    const change = size - this.state.pool.length;
    const promises: Promise<void>[] = [];
    for (let i = 0; i < change; i++) {
      console.log("push", i);
      promises.push(
        new Promise<void>(async (resolve) => {
          ++this.poolCounter;
          const filename = `${(Date.now() - 1704063600).toString(16).padStart(8, "0")}-${this.poolCounter.toString(16).padStart(8, "0")}`;
          const fh = await this.#dataDirAh.getFileHandle(filename, {
            create: true,
          });
          console.log("do", i);
          const sh: FileSystemSyncAccessHandle = await (
            fh as any
          ).createSyncAccessHandle();
          this.#fh.set(filename, fh);
          this.#sh.set(filename, sh);
          this.#logWAL({
            opp: "createPoolFile",
            args: [filename],
          });
          this.state.pool.push(filename);
          resolve();
        }),
      );
    }
    for (let i = 0; i > change; i--) {
      promises.push(
        new Promise<void>(async (resolve) => {
          const filename = this.state.pool.pop()!;
          this.#logWAL({
            opp: "deletePoolFile",
            args: [filename],
          });
          const fh = this.#fh.get(filename)!;
          const sh = this.#sh.get(filename);
          sh?.close();
          // @ts-ignore
          await fh.remove();
          this.#fh.delete(filename);
          this.#sh.delete(filename);
          resolve();
        }),
      );
    }
    await Promise.all(promises);
  }

  _createPoolFileState(filename: string) {
    this.state.pool.push(filename);
  }

  _deletePoolFileState(filename: string) {
    const index = this.state.pool.indexOf(filename);
    if (index > -1) {
      this.state.pool.splice(index, 1);
    }
  }

  async maybeCheckpointState() {
    if (Date.now() - this.lastCheckpoint > this.checkpointInterval) {
      await this.checkpointState();
    }
  }

  async checkpointState() {
    const stateAB = new TextEncoder().encode(JSON.stringify(this.state));
    this.#stateSH.truncate(0);
    this.#stateSH.write(stateAB, { at: 0 });
    this.#stateSH.flush();
    this.lastCheckpoint = Date.now();
  }

  flush() {
    for (const sh of this.#unsyncedSH) {
      try {
        sh.flush();
      } catch (e) {} // The file may have been closed if it was deleted
    }
    this.#unsyncedSH.clear();
  }

  exit(): void {
    for (const sh of this.#sh.values()) {
      sh.close();
    }
    this.#stateSH.flush();
    this.#stateSH.close();
  }

  // Filesystem API:

  chmod(path: string, mode: number): void {
    this.#tryWithWAL({ opp: "chmod", args: [path, mode] }, () => {
      this._chmodState(path, mode);
    });
  }

  _chmodState(path: string, mode: number): void {
    const node = this.#resolvePath(path);
    node.mode = mode;
  }

  close(fd: number): void {
    const path = this.#getPathFromFd(fd);
    this.#openHandlePaths.delete(fd);
    this.#openHandleIds.delete(path);
  }

  fstat(fd: number): FsStats {
    const path = this.#getPathFromFd(fd);
    return this.lstat(path);
  }

  lstat(path: string): FsStats {
    const node = this.#resolvePath(path);
    const size =
      node.type === "file" ? this.#sh.get(node.backingFilename)!.getSize() : 0;
    const blksize = 4096;
    return {
      dev: 0,
      ino: 0,
      mode: node.mode,
      nlink: 1,
      uid: 0,
      gid: 0,
      rdev: 0,
      size,
      blksize,
      blocks: Math.ceil(size / blksize),
      atime: node.lastModified,
      mtime: node.lastModified,
      ctime: node.lastModified,
    };
  }

  mkdir(path: string, options?: { recursive?: boolean; mode?: number }): void {
    this.#tryWithWAL({ opp: "mkdir", args: [path, options] }, () => {
      this._mkdirState(path, options);
    });
  }

  _mkdirState(
    path: string,
    options?: { recursive?: boolean; mode?: number },
  ): void {
    const parts = this.#pathParts(path);
    const newDirName = parts.pop()!;
    let currentPath = [];
    let node = this.state.root;
    for (const part of parts) {
      currentPath.push(path);
      if (!node.children.hasOwnProperty(part)) {
        if (options?.recursive) {
          this.mkdir(currentPath.join("/"));
        } else {
          throw new FsError("ENOENT", "No such file or directory");
        }
      }
      if (node.children[part].type !== "directory") {
        throw new FsError("ENOTDIR", "Not a directory");
      }
      node = node.children[part] as DirectoryNode;
    }
    if (node.children.hasOwnProperty(newDirName)) {
      throw new FsError("EEXIST", "File exists");
    }
    const newDir: DirectoryNode = {
      type: "directory",
      lastModified: Date.now(),
      mode: options?.mode || INITIAL_MODE.DIR,
      children: {},
    };
    node.children[newDirName] = newDir;
  }

  open(path: string, flags?: string, mode?: number): number {
    const node = this.#resolvePath(path);
    if (node.type !== "file") {
      throw new FsError("EISDIR", "Is a directory");
    }
    const handleId = this.#nextHandleId();
    this.#openHandlePaths.set(handleId, path);
    this.#openHandleIds.set(path, handleId);
    return handleId;
  }

  readdir(path: string): string[] {
    const node = this.#resolvePath(path);
    if (node.type !== "directory") {
      throw new FsError("ENOTDIR", "Not a directory");
    }
    return Object.keys(node.children);
  }

  read(
    fd: number,
    buffer: Int8Array, // Buffer to read into
    offset: number, // Offset in buffer to start writing to
    length: number, // Number of bytes to read
    position: number, // Position in file to read from
  ): number {
    const path = this.#getPathFromFd(fd);
    const node = this.#resolvePath(path);
    if (node.type !== "file") {
      throw new FsError("EISDIR", "Is a directory");
    }
    const sh = this.#sh.get(node.backingFilename)!;
    return sh.read(new Int8Array(buffer.buffer, offset, length), {
      at: position,
    });
  }

  rename(oldPath: string, newPath: string): void {
    this.#tryWithWAL({ opp: "rename", args: [oldPath, newPath] }, () => {
      this._renameState(oldPath, newPath, true);
    });
  }

  _renameState(oldPath: string, newPath: string, doFileOps = false): void {
    const oldPathParts = this.#pathParts(oldPath);
    const oldFilename = oldPathParts.pop()!;
    const oldParent = this.#resolvePath(
      oldPathParts.join("/"),
    ) as DirectoryNode;
    if (!oldParent.children.hasOwnProperty(oldFilename)) {
      throw new FsError("ENOENT", "No such file or directory");
    }
    const newPathParts = this.#pathParts(newPath);
    const newFilename = newPathParts.pop()!;
    const newParent = this.#resolvePath(
      newPathParts.join("/"),
    ) as DirectoryNode;
    if (doFileOps && newParent.children.hasOwnProperty(newFilename)) {
      // Overwrite, so return the underlying file to the pool
      const node = newParent.children[newFilename]! as FileNode;
      const sh = this.#sh.get(node.backingFilename)!;
      sh.truncate(0);
      this.state.pool.push(node.backingFilename);
    }
    newParent.children[newFilename] = oldParent.children[oldFilename]!;
    delete oldParent.children[oldFilename];
  }

  rmdir(path: string): void {
    this.#tryWithWAL({ opp: "rmdir", args: [path] }, () => {
      this._rmdirState(path);
    });
  }

  _rmdirState(path: string): void {
    const pathParts = this.#pathParts(path);
    const dirName = pathParts.pop()!;
    const parent = this.#resolvePath(pathParts.join("/")) as DirectoryNode;
    if (!parent.children.hasOwnProperty(dirName)) {
      throw new FsError("ENOENT", "No such file or directory");
    }
    const node = parent.children[dirName]!;
    if (node.type !== "directory") {
      throw new FsError("ENOTDIR", "Not a directory");
    }
    if (Object.keys(node.children).length > 0) {
      throw new FsError("ENOTEMPTY", "Directory not empty");
    }
    delete parent.children[dirName];
  }

  truncate(path: string, len = 0): void {
    const node = this.#resolvePath(path);
    if (node.type !== "file") {
      throw new FsError("EISDIR", "Is a directory");
    }
    const sh = this.#sh.get(node.backingFilename);
    if (!sh) {
      throw new FsError("ENOENT", "No such file or directory");
    }
    sh.truncate(len);
    this.#unsyncedSH.add(sh);
  }

  unlink(path: string): void {
    this.#tryWithWAL({ opp: "unlink", args: [path] }, () => {
      this._unlinkState(path, true);
    });
  }

  _unlinkState(path: string, doFileOps = false): void {
    const pathParts = this.#pathParts(path);
    const filename = pathParts.pop()!;
    const dir = this.#resolvePath(pathParts.join("/")) as DirectoryNode;
    if (!dir.children.hasOwnProperty(filename)) {
      throw new FsError("ENOENT", "No such file or directory");
    }
    const node = dir.children[filename]!;
    if (node.type !== "file") {
      throw new FsError("EISDIR", "Is a directory");
    }
    delete dir.children[filename];
    if (doFileOps) {
      const sh = this.#sh.get(node.backingFilename)!;
      // We don't delete the file, it's truncated and returned to the pool
      sh?.truncate(0);
      this.#unsyncedSH.add(sh);
      if (this.#openHandleIds.has(path)) {
        this.#openHandlePaths.delete(this.#openHandleIds.get(path)!);
        this.#openHandleIds.delete(path);
      }
    }
    this.state.pool.push(node.backingFilename);
  }

  utimes(path: string, atime: number, mtime: number): void {
    this.#tryWithWAL({ opp: "utimes", args: [path, atime, mtime] }, () => {
      this._utimesState(path, atime, mtime);
    });
  }

  _utimesState(path: string, atime: number, mtime: number): void {
    const node = this.#resolvePath(path);
    node.lastModified = mtime;
  }

  writeFile(
    path: string,
    data: string | Int8Array,
    options?: { encoding?: string; mode?: number; flag?: string },
  ): void {
    const pathParts = this.#pathParts(path);
    const filename = pathParts.pop()!;
    const parent = this.#resolvePath(pathParts.join("/")) as DirectoryNode;

    if (!parent.children.hasOwnProperty(filename)) {
      if (this.state.pool.length === 0) {
        throw new Error("No more file handles available in the pool");
      }
      const node: Node = {
        type: "file",
        lastModified: Date.now(),
        mode: options?.mode || INITIAL_MODE.FILE,
        backingFilename: this.state.pool.pop()!,
      };
      parent.children[filename] = node;
      this.#logWAL({
        opp: "createFileNode",
        args: [path, node],
      });
    } else {
      const node = parent.children[filename] as FileNode;
      node.lastModified = Date.now();
      this.#logWAL({
        opp: "setLastModified",
        args: [path, node.lastModified],
      });
    }
    const node = parent.children[filename] as FileNode;
    const sh = this.#sh.get(node.backingFilename)!;
    // Files in pool are empty, only write if data is provided
    if (data.length > 0) {
      sh.write(
        typeof data === "string"
          ? new TextEncoder().encode(data)
          : new Int8Array(data),
        { at: 0 },
      );
      if (path.startsWith("/pg_wal")) {
        this.#unsyncedSH.add(sh);
      }
    }
  }

  _createFileNodeState(path: string, node: FileNode): FileNode {
    const pathParts = this.#pathParts(path);
    const filename = pathParts.pop()!;
    const parent = this.#resolvePath(pathParts.join("/")) as DirectoryNode;
    parent.children[filename] = node;
    // remove backingFilename from pool
    const index = this.state.pool.indexOf(node.backingFilename);
    if (index > -1) {
      this.state.pool.splice(index, 1);
    }
    return node;
  }

  _setLastModifiedState(path: string, lastModified: number): void {
    const node = this.#resolvePath(path);
    node.lastModified = lastModified;
  }

  write(
    fd: number,
    buffer: Int8Array, // Buffer to read from
    offset: number, // Offset in buffer to start reading from
    length: number, // Number of bytes to write
    position: number, // Position in file to write to
  ): number {
    const path = this.#getPathFromFd(fd);
    const node = this.#resolvePath(path);
    if (node.type !== "file") {
      throw new FsError("EISDIR", "Is a directory");
    }
    const sh = this.#sh.get(node.backingFilename);
    if (!sh) {
      throw new FsError("EBADF", "Bad file descriptor");
    }
    const ret = sh.write(new Int8Array(buffer, offset, length), {
      at: position,
    });
    if (path.startsWith("/pg_wal")) {
      this.#unsyncedSH.add(sh);
    }
    return ret;
  }

  // Internal methods:

  #tryWithWAL(entry: WALEntry, fn: () => void) {
    const offset = this.#logWAL(entry);
    try {
      fn();
    } catch (e) {
      // Rollback WAL entry
      this.#stateSH.truncate(offset);
      throw e;
    }
  }

  #logWAL(entry: WALEntry) {
    const entryJSON = JSON.stringify(entry);
    const stateAB = new TextEncoder().encode(`\n${entryJSON}`);
    const offset = this.#stateSH.getSize();
    this.#stateSH.write(stateAB, { at: offset });
    this.#unsyncedSH.add(this.#stateSH);
    return offset;
  }

  #pathParts(path: string): string[] {
    return path.split("/").filter(Boolean);
  }

  #resolvePath(path: string, from?: DirectoryNode): Node {
    const parts = this.#pathParts(path);
    let node: Node = from || this.state.root;
    for (const part of parts) {
      if (node.type !== "directory") {
        throw new FsError("ENOTDIR", "Not a directory");
      }
      if (!node.children.hasOwnProperty(part)) {
        throw new FsError("ENOENT", "No such file or directory");
      }
      node = node.children[part]!;
    }
    return node;
  }

  #getPathFromFd(fd: number): string {
    const path = this.#openHandlePaths.get(fd);
    if (!path) {
      throw new FsError("EBADF", "Bad file descriptor");
    }
    return path;
  }

  #nextHandleId(): number {
    const id = ++this.#handleIdCounter;
    while (this.#openHandlePaths.has(id)) {
      this.#handleIdCounter++;
    }
    return id;
  }

  async #resolveOpfsDirectory(
    path: string,
    options?: {
      from?: FileSystemDirectoryHandle;
      create?: boolean;
    },
  ): Promise<FileSystemDirectoryHandle> {
    const parts = this.#pathParts(path);
    let ah = options?.from || this.#opfsRootAh;
    for (const part of parts) {
      ah = await ah.getDirectoryHandle(part, { create: options?.create });
    }
    return ah;
  }
}
