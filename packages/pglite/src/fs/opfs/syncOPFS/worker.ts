import { states, slot, waitFor, FsError } from "./shared.js";
import type {
  FsStats,
  ResponseJson,
  ResponseJsonOk,
  ResponseJsonError,
  OpenFd,
  FileSystemSyncAccessHandle,
  CallMsg,
} from "./shared.js";

// State
let fdCounter = 10;
const openFd = new Map<number, OpenFd>();
const fdMap = new Map<string, number>(); // OPFS only allows a file to be opend once, so we keep a map of path to Fd for things such as lstat

let controlBuffer: SharedArrayBuffer;
let callBuffer: SharedArrayBuffer;
let responseBuffer: SharedArrayBuffer;
let sharedBuffers: SharedArrayBuffer[];

let controlArray: Int32Array;
let callArray: Uint8Array;
let responseArray: Uint8Array;

let root: FileSystemDirectoryHandle;

async function init() {
  // Root OPFS
  root = await navigator.storage.getDirectory();

  // send 'here' message to indicate that the worker is ready
  self.postMessage({ type: "here" });

  // Wait for the main thread to send the buffers
  const msg = await new Promise<{
    controlBuffer: SharedArrayBuffer;
    callBuffer: SharedArrayBuffer;
    responseBuffer: SharedArrayBuffer;
    sharedBuffers: SharedArrayBuffer[];
  }>((resolve) => {
    self.addEventListener(
      "message",
      (event) => {
        if (event.data.type === "init") {
          resolve(event.data);
        } else {
          throw new Error("Unexpected message from main thread");
        }
      },
      { once: true },
    );
  });

  controlBuffer = msg.controlBuffer;
  callBuffer = msg.callBuffer;
  responseBuffer = msg.responseBuffer;
  sharedBuffers = msg.sharedBuffers;

  controlArray = new Int32Array(controlBuffer);
  callArray = new Uint8Array(callBuffer);
  responseArray = new Uint8Array(responseBuffer);

  // Send the 'ready' message to the main thread
  self.postMessage({ type: "ready" });
  mainLoop();
}

async function mainLoop() {
  while (true) {
    waitForState(states.CALL);
    setState(states.PROCESS);
    const callLength = Atomics.load(controlArray, slot.CALL_LENGTH);
    const callMsg: CallMsg = JSON.parse(
      new TextDecoder().decode(callArray.slice(0, callLength)),
    );
    let responseJson: ResponseJson;
    try {
      if (!methods[callMsg.method]) {
        throw new Error(`Method not found: ${callMsg.method}`);
      }
      const result = await methods[callMsg.method](...callMsg.args);
      responseJson = { value: result } as ResponseJsonOk;
    } catch (error) {
      responseJson = {
        error: {
          message: (error as FsError).message,
          code: (error as FsError).code,
        },
      } as ResponseJsonError;
    }
    const responseJsonStr = JSON.stringify(responseJson);
    const responseJsonStrBytes = new TextEncoder().encode(responseJsonStr);
    responseArray.set(responseJsonStrBytes);
    Atomics.store(
      controlArray,
      slot.RESPONSE_LENGTH,
      responseJsonStrBytes.length,
    );
    setState(states.RESPONSE);
  }
}

const methods: Record<string, (...args: any[]) => any> = {
  async close(fd: number): Promise<void> {
    const fdEntry = openFd.get(fd);
    if (!fdEntry) {
      throw new Error(`File descriptor not found: ${fd}`);
    }
    fdEntry.syncHandle.close();
    fdMap.delete(fdEntry.path);
    openFd.delete(fd);
  },

  async fstat(fd: number): Promise<FsStats> {
    const fdEntry = openFd.get(fd);
    if (!fdEntry) {
      throw new Error(`File descriptor not found: ${fd}`);
    }
    return await statForHandle(fdEntry.handle);
  },

  async lstat(path: string): Promise<FsStats> {
    const handle = await resolveHandle(path);
    return await statForHandle(handle);
  },

  async mkdir(
    path: string,
    options?: { recursive: boolean; mode: number },
  ): Promise<void> {
    const parts = path.split("/");
    const tip = parts.pop()!;
    let currentDir = root;
    try {
      for (const part of parts) {
        currentDir = await currentDir.getDirectoryHandle(part, {
          create: options?.recursive,
        });
      }
    } catch (error) {
      throw new FsError("ENOENT", `Dir not found: ${path}`);
    }
    currentDir.getDirectoryHandle(tip, { create: true });
  },

  async open(path: string, _flags?: string, _mode?: number): Promise<number> {
    const handle = await resolveFileHandle(path);
    const id = fdCounter++;
    openFd.set(id, {
      id,
      path,
      handle,
      syncHandle: await (handle as any).createSyncAccessHandle(),
    });
    fdMap.set(path, id);
    return id;
  },

  async readdir(path: string): Promise<string[]> {
    const dirHandle = await resolveDirectoryHandle(path);
    const entries = [];
    for await (const entry of (dirHandle as any).keys()) {
      entries.push(entry);
    }
    return entries;
  },

  async read(
    fd: number,
    buffer: number, // number of sharedBuffer or -1 for copy via responseBuffer
    offset: number,
    length: number,
    position: number,
  ): Promise<number> {
    const fdEntry = openFd.get(fd);
    if (!fdEntry) {
      throw new Error(`File descriptor not found: ${fd}`);
    }
    if (buffer >= 0) {
      const sharedBuffer = sharedBuffers[buffer];
      if (!sharedBuffer) {
        throw new Error(`Shared buffer not found: ${buffer}`);
      }
      const view = new Uint8Array(sharedBuffer, offset, length);
      const bytesRead = fdEntry.syncHandle.read(view, { at: position });
      return bytesRead;
    } else {
      // Read chunks from the file in chunks the size of the responseBuffer
      // and write them to the responseBuffer
      let read = 0;
      while (read < length) {
        const chunkLength = Math.min(responseBuffer.byteLength, length - read);
        const view = new Uint8Array(responseBuffer, 0, chunkLength);
        const bytesRead = fdEntry.syncHandle.read(view, {
          at: position + read,
        });
        controlArray[slot.RESPONSE_LENGTH] = bytesRead;
        read += bytesRead;
        setState(states.ASK_NEXT);
        waitForState(states.SEND_NEXT);
        if (read >= length || bytesRead <= chunkLength) {
          break;
        }
      }
      return read;
    }
  },

  async rename(oldPath: string, newPath: string): Promise<void> {
    // OPFS does not have a rename method, so we have to copy and delete
    let exists = false;
    try {
      if (await resolveHandle(newPath)) {
        exists = true;
      }
    } catch {}
    if (exists) {
      throw new Error(`File already exists: ${newPath}`);
    }
    const handle = await resolveHandle(oldPath);
    const type = handle.kind;
    const newPathParts = newPath.split("/");
    const newEntryName = newPathParts.pop()!;
    const newDirHandle = await resolveDirectoryHandle(newPathParts);
    if (type === "file") {
      const oldFile = await handle.getFile();
      const newFileHandle = await newDirHandle.getFileHandle(newEntryName, {
        create: true,
      });
      const newFile = await newFileHandle.createWritable();
      await newFile.write(oldFile);
      await newFile.close();
      await (handle as any).remove();
    } else {
      throw new Error("Rename directory not implemented");
    }
  },

  async rmdir(path: string): Promise<void> {
    const handle = await resolveDirectoryHandle(path);
    await (handle as any).remove();
  },

  async truncate(path: string, len: number): Promise<void> {
    const handle = await resolveFileHandle(path);
    const file = await handle.createWritable();
    await file.truncate(len);
    await file.close();
  },

  async unlink(path: string): Promise<void> {
    // try {
    const handle = await resolveFileHandle(path);
    await (handle as any).remove();
    // } catch (error) {}
  },

  async writeFile(
    path: string,
    data: string,
    _options?: { encoding: string; mode: number; flag: string },
  ): Promise<void> {
    const handle = await resolveFileHandle(path, true);
    const writable = await handle.createWritable();
    await writable.write(data);
    await writable.close();
  },

  async write(
    fd: number,
    buffer: number, // number of sharedBuffer or -1 for copy via responseBuffer
    offset: number,
    length: number,
    position: number,
  ): Promise<number> {
    const fdEntry = openFd.get(fd);
    if (!fdEntry) {
      throw new Error(`File descriptor not found: ${fd}`);
    }
    if (buffer >= 0) {
      const sharedBuffer = sharedBuffers[buffer];
      if (!sharedBuffer) {
        throw new Error(`Shared buffer not found: ${buffer}`);
      }
      const view = new Uint8Array(sharedBuffer, offset, length);
      const bytesWritten = fdEntry.syncHandle.write(view, { at: position });
      return bytesWritten;
    } else {
      // Read chunks from the callBuffer in chunks the size of the callBuffer
      // and write them to the file
      let written = 0;
      while (written < length) {
        setState(states.ASK_NEXT);
        waitForState(states.SEND_NEXT);
        const chunkLength = Math.min(callArray.byteLength, length - written);
        const chunk = callArray.slice(0, chunkLength);
        const bytesWritten = fdEntry.syncHandle.write(chunk, {
          at: position + written,
        });
        written += bytesWritten;
        if (written >= length) {
          break;
        }
      }
      return written;
    }
  },
};

async function resolveDirectoryHandle(
  path: string | string[],
  create = false,
): Promise<FileSystemDirectoryHandle> {
  try {
    const pathParts = Array.isArray(path) ? path : path.split("/");
    let handle = root;
    for (const part of pathParts) {
      if (!part) {
        continue;
      }
      handle = await handle.getDirectoryHandle(part, { create });
    }
    return handle;
  } catch (error) {
    throw new FsError("ENOENT", `Dir not found: ${path}`);
  }
}

async function resolveFileHandle(
  path: string,
  create = false,
  createDirs = false,
): Promise<FileSystemFileHandle> {
  try {
    const pathParts = path.split("/");
    const fileName = pathParts.pop()!;
    const dirHandle = await resolveDirectoryHandle(pathParts, createDirs);
    return dirHandle.getFileHandle(fileName, { create });
  } catch (error) {
    throw new FsError("ENOENT", `File not found: ${path}`);
  }
}

async function resolveHandle(
  path: string,
): Promise<FileSystemFileHandle | FileSystemDirectoryHandle> {
  const pathParts = Array.isArray(path) ? path : path.split("/");
  const tip = pathParts.pop()!;
  let handle = root;
  try {
    for (const part of pathParts) {
      if (!part) {
        continue;
      }
      handle = await handle.getDirectoryHandle(part);
    }
  } catch {
    throw new FsError("ENOENT", `Path not found: ${path}`);
  }
  try {
    return await handle.getFileHandle(tip);
  } catch {
    try {
      return await handle.getDirectoryHandle(tip);
    } catch {
      throw new FsError("ENOENT", `Path not found: ${path}`);
    }
  }
}

async function statForHandle(handle: FileSystemHandle): Promise<FsStats> {
  const kind = handle.kind;
  let size = 0;
  if (kind === "file") {
    const file = await (handle as FileSystemFileHandle).getFile();
    size = file.size;
  }
  const blksize = 4096;
  const blocks = Math.ceil(size / blksize);
  return {
    dev: 0,
    ino: 0,
    mode: kind === "file" ? 32768 : 16384,
    nlink: 0,
    uid: 0,
    gid: 0,
    rdev: 0,
    size,
    atime: 0,
    mtime: 0,
    ctime: 0,
    blksize,
    blocks,
  };
}

function waitForState(state: number | number[]) {
  return waitFor(controlArray, slot.STATE, state);
}

function setState(state: number) {
  controlArray[slot.STATE] = state;
  Atomics.notify(controlArray, slot.STATE);
}

init();
