import type { PostgresMod } from "../../postgres.js";
import type { SyncOPFS } from "./syncOPFS/index.js";
import { FsError, ERRNO_CODES } from "./syncOPFS/shared.js";

export type FileSystemType = Emscripten.FileSystemType & {
  createNode: (
    parent: FSNode | null,
    name: string,
    mode: number,
    dev?: any
  ) => FSNode;
  node_ops: FS.NodeOps;
  stream_ops: FS.StreamOps & {
    dup: (stream: FSStream) => void;
    mmap: (
      stream: FSStream,
      length: number,
      position: number,
      prot: any,
      flags: any
    ) => { ptr: number; allocated: boolean };
    msync: (
      stream: FSStream,
      buffer: Uint8Array,
      offset: number,
      length: number,
      mmapFlags: any
    ) => number;
  };
} & { [key: string]: any };

type FSNode = FS.FSNode & {
  node_ops: FS.NodeOps;
  stream_ops: FS.StreamOps;
};

type FSStream = FS.FSStream & {
  node: FSNode;
  shared: {
    refcount: number;
  };
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

export const createOPFS = (Module: PostgresMod, syncOPFS: SyncOPFS) => {
  console.log("createOPFS");
  if (typeof SharedArrayBuffer === "undefined") {
    throw new Error(
      [
        "PGlite with OPFS requires SharedArrayBuffer support.",
        "It requires HTTPS or localhost and specific CORS headers to work.",
        "See https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer#security_requirements for more details.",
      ].join("\n")
    );
  }
  const FS = Module.FS as EmscriptenFS;
  const OPFS = {
    tryFSOperation<T>(f: () => T): T {
      try {
        return f();
      } catch (e: any) {
        if (!e.code) throw e;
        if (e.code === "UNKNOWN") throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
        throw new FS.ErrnoError(e.code);
      }
    },
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
      return OPFS.tryFSOperation(() => {
        const stats = syncOPFS.lstat(path);
        return stats.mode;
      });
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
        return OPFS.tryFSOperation(() => {
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
        });
      },
      setattr(node: OpfsNode, attr: FS.Stats): void {
        // NOOP
        console.warn("setattr not possible in OPFS");
      },
      lookup(parent: FSNode, name: string): OpfsNode {
        const path = [OPFS.realPath(parent), name].join("/");
        return OPFS.tryFSOperation(() => {
          const mode = OPFS.getMode(path);
          return OPFS.createNode(parent, name, mode);
        });
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
        return OPFS.tryFSOperation(() => {
          if (FS.isDir(node.mode)) {
            syncOPFS.mkdir(path);
          } else {
            syncOPFS.writeFile(path, "");
          }
          return node;
        });
      },
      rename(oldNode: OpfsNode, newDir: OpfsNode, newName: string): void {
        const oldPath = OPFS.realPath(oldNode);
        const newPath = [OPFS.realPath(newDir), newName].join("/");
        return OPFS.tryFSOperation(() => {
          syncOPFS.rename(oldPath, newPath);
        });
      },
      unlink(parent: OpfsNode, name: string): void {
        const path = [OPFS.realPath(parent), name].join("/");
        return OPFS.tryFSOperation(() => {
          syncOPFS.unlink(path);
        });
      },
      rmdir(parent: OpfsNode, name: string): void {
        const path = [OPFS.realPath(parent), name].join("/");
        return OPFS.tryFSOperation(() => {
          syncOPFS.rmdir(path);
        });
      },
      readdir(node: OpfsNode): string[] {
        const path = OPFS.realPath(node);
        return OPFS.tryFSOperation(() => {
          return syncOPFS.readdir(path);
        });
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
        return OPFS.tryFSOperation(() => {
          if (FS.isFile(stream.node.mode)) {
            stream.shared.refcount = 1;
            stream.nfd = syncOPFS.open(path);
          }
        });
      },
      close(stream: FSStream): void {
        return OPFS.tryFSOperation(() => {
          if (
            FS.isFile(stream.node.mode) &&
            stream.nfd &&
            --stream.shared.refcount === 0
          ) {
            syncOPFS.close(stream.nfd);
          }
        });
      },
      dup(stream: FSStream) {
        stream.shared.refcount++;
      },
      read(
        stream: FS.FSStream,
        buffer: Uint8Array | Int8Array,
        offset: number,
        length: number,
        position: number
      ): number {
        if (length === 0) return 0;
        return OPFS.tryFSOperation(() =>
          syncOPFS.read(
            stream.nfd!,
            new Int8Array(buffer.buffer, offset, length),
            0,
            length,
            position
          )
        );
      },
      write(
        stream: FS.FSStream,
        buffer: Uint8Array | Int8Array, // Buffer to read from
        offset: number, //
        length: number,
        position: number
      ): number {
        return OPFS.tryFSOperation(() =>
          syncOPFS.write(
            stream.nfd!,
            new Int8Array(buffer.buffer, offset, length),
            0,
            length,
            position
          )
        );
      },
      llseek(stream: FSStream, offset: number, whence: number): number {
        var position = offset;
        if (whence === 1) {
          // SEEK_CUR.
          position += stream.position;
        } else if (whence === 2) {
          // SEEK_END.
          if (FS.isFile(stream.node.mode)) {
            OPFS.tryFSOperation(() => {
              var stat = syncOPFS.fstat(stream.nfd!);
              position += stat.size;
            });
          }
        }

        if (position < 0) {
          throw new FS.ErrnoError(28);
        }

        return position;
      },
      mmap(
        stream: FSStream,
        length: number,
        position: number,
        prot: any,
        flags: any
      ) {
        if (!FS.isFile(stream.node.mode)) {
          throw new FS.ErrnoError(ERRNO_CODES.ENODEV);
        }

        var ptr = (Module as any).mmapAlloc(length); // TODO: Fix type and check this is exported

        OPFS.stream_ops.read(stream, Module.HEAP8, ptr, length, position);
        return { ptr, allocated: true };
      },
      msync(
        stream: FSStream,
        buffer: Uint8Array,
        offset: number,
        length: number,
        mmapFlags: any
      ) {
        OPFS.stream_ops.write(stream, buffer, 0, length, offset);
        return 0;
      },
    },
  } satisfies FileSystemType;
  return OPFS;
};
