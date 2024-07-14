import type { PostgresMod } from "../../postgres.js";
import { SyncOPFS } from "./syncOPFS/index.js";

export type FileSystemType = Emscripten.FileSystemType & {
  createNode: (
    parent: FSNode | null,
    name: string,
    mode: number,
    dev?: any
  ) => FSNode;
  node_ops: FS.NodeOps;
  stream_ops: FS.StreamOps;
} & { [key: string]: any };

type FSNode = FS.FSNode & {
  node_ops: FS.NodeOps;
  stream_ops: FS.StreamOps;
};

type FSStream = FS.FSStream & {
  node: FSNode;
};

export interface OpfsMount extends FS.Mount {
  opts: {
    root: string;
  };
}

type OpfsNode = FSNode & {};

type EmscriptenFS = PostgresMod["FS"] & {
  createNode: (
    parent: FSNode | null,
    name: string,
    mode: number,
    dev?: any
  ) => FSNode;
};

export const createOPFS = (
  Module: PostgresMod,
  sharedBuffers?: Array<SharedArrayBuffer>,
  callBufferSize?: number,
  responseBufferSize?: number
) => {
  if (typeof SharedArrayBuffer === "undefined") {
    throw new Error("OPFS requires SharedArrayBuffer");
  }
  const FS = Module.FS as EmscriptenFS;
  const syncOPFS = new SyncOPFS({
    sharedBuffers: [
      // Module.HEAPU8.buffer, // TODO: How do we make read/write to the HEAP work with a SharedArrayBuffer?
      ...(sharedBuffers || []),
    ],
    callBufferSize: callBufferSize,
    responseBufferSize: responseBufferSize,
  });
  const OPFS = {
    mount(mount: OpfsMount): FSNode {
      return OPFS.createNode(null, "/", 16384 | 511, 0);
    },
    syncfs(
      mount: FS.Mount,
      populate: () => unknown,
      done: (err?: number | null) => unknown
    ): void {
      // NOOP
    },
    createNode(
      parent: FSNode | null,
      name: string,
      mode: number,
      dev?: any
    ): OpfsNode {
      if (!FS.isDir(mode) && !FS.isFile(mode)) {
        throw new FS.ErrnoError(28);
      }
      const node = FS.createNode(parent, name, mode);
      node.node_ops = OPFS.node_ops;
      node.stream_ops = OPFS.stream_ops;
      return node;
    },
    getMode: function (path: string): number {
      const stats = syncOPFS.lstat(path);
      return stats.mode;
    },
    realPath: function (node: FSNode): string {
      const parts = [];
      while (node.parent !== node) {
        parts.push(node.name);
        node = node.parent as FSNode;
      }
      parts.push((node.mount as OpfsMount).opts.root);
      parts.reverse();
      return parts.join("/");
    },
    node_ops: {
      getattr(node: OpfsNode): FS.Stats {
        const path = OPFS.realPath(node);
        const stats = syncOPFS.lstat(path);
        return {
          ...stats,
          dev: 0,
          ino: node.id,
          nlink: 1,
          rdev: node.rdev,
          atime: new Date(stats.atime),
          mtime: new Date(stats.mtime),
          ctime: new Date(stats.ctime),
        };
      },
      setattr(node: OpfsNode, attr: FS.Stats): void {
        // NOOP
        console.warn("setattr not possible in OPFS");
      },
      lookup(parent: FSNode, name: string): OpfsNode {
        const path = [OPFS.realPath(parent), name].join("/");
        const mode = OPFS.getMode(path);
        return OPFS.createNode(parent, name, mode);
      },
      mknod(
        parent: FSNode,
        name: string,
        mode: number,
        dev: unknown
      ): OpfsNode {
        const node = OPFS.createNode(parent, name, mode, dev);
        // create the backing node for this in the fs root as well
        const path = OPFS.realPath(node);
        if (FS.isDir(node.mode)) {
          syncOPFS.mkdir(path);
        } else {
          syncOPFS.writeFile(path, "");
        }
        return node;
      },
      rename(oldNode: OpfsNode, newDir: OpfsNode, newName: string): void {
        const oldPath = OPFS.realPath(oldNode);
        const newPath = [OPFS.realPath(newDir), newName].join("/");
        syncOPFS.rename(oldPath, newPath);
      },
      unlink(parent: OpfsNode, name: string): void {
        const path = [OPFS.realPath(parent), name].join("/");
        syncOPFS.unlink(path);
      },
      rmdir(parent: OpfsNode, name: string): void {
        const path = [OPFS.realPath(parent), name].join("/");
        syncOPFS.rmdir(path);
      },
      readdir(node: OpfsNode): string[] {
        const path = OPFS.realPath(node);
        return syncOPFS.readdir(path);
      },
      symlink(parent: FSNode, newName: string, oldPath: string): void {
        // This is not supported by OPFS
        throw new FS.ErrnoError(63);
      },
      readlink(node: FSNode): string {
        // This is not supported by OPFS
        throw new FS.ErrnoError(63);
      },
    },
    stream_ops: {
      open(stream: FSStream): void {
        const path = OPFS.realPath(stream.node);
        if (FS.isFile(stream.node.mode)) {
          stream.nfd = syncOPFS.open(path);
        }
      },
      close(stream: FSStream): void {
        if (FS.isFile(stream.node.mode) && stream.nfd) {
          syncOPFS.close(stream.nfd);
        }
      },
      read(
        stream: FS.FSStream,
        buffer: Uint8Array,
        offset: number,
        length: number,
        position: number
      ): number {
        // TODO
      },
      write(
        stream: FS.FSStream,
        buffer: Uint8Array,
        offset: number,
        length: number,
        position: number
      ): number {
        // TODO
      },
      llseek(stream: FSStream, offset: number, whence: number): number {
        var position = offset;
        if (whence === 1) {
          // SEEK_CUR.
          position += stream.position;
        } else if (whence === 2) {
          // SEEK_END.
          if (FS.isFile(stream.node.mode)) {
            var stat = syncOPFS.fstat(stream.nfd!);
            position += stat.size;
          }
        }

        if (position < 0) {
          throw new FS.ErrnoError(28);
        }

        return position;
      },
    },
  } satisfies FileSystemType;
  return OPFS;
};
