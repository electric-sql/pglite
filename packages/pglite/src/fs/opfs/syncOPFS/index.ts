import { states, slot, waitFor, FsError } from "./shared.js";
import type { FsStats, ResponseJson, CallMsg } from "./shared.js";

const DEFAULT_BUFFER_SIZE = 8192; // 8KB - Postgres default page size

interface SyncOpfsOptions {
  sharedBuffers?: Array<SharedArrayBuffer>;
  callBufferSize?: number;
  responseBufferSize?: number;
}

export class SyncOPFS {
  #worker?: Worker;
  readyPromise: Promise<void>;
  #ready = false;

  #controlBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 3);
  #controlArray = new Int32Array(this.#controlBuffer);

  #callBuffer: SharedArrayBuffer;
  #callArray: Uint8Array;

  #responseBuffer: SharedArrayBuffer;
  #responseArray: Uint8Array;

  #sharedBuffers: Array<SharedArrayBuffer>;

  constructor({
    sharedBuffers,
    callBufferSize,
    responseBufferSize,
  }: SyncOpfsOptions) {
    this.#sharedBuffers = sharedBuffers || [];

    this.#callBuffer = new SharedArrayBuffer(
      callBufferSize || DEFAULT_BUFFER_SIZE,
    );
    this.#callArray = new Uint8Array(this.#callBuffer);

    this.#responseBuffer = new SharedArrayBuffer(
      responseBufferSize || DEFAULT_BUFFER_SIZE,
    );
    this.#responseArray = new Uint8Array(this.#responseBuffer);

    // Set up the control array
    this.#controlArray[slot.STATE] = states.IDLE; // state
    this.#controlArray[slot.CALL_LENGTH] = 0; // callLength
    this.#controlArray[slot.RESPONSE_LENGTH] = 0; // responseLength

    this.readyPromise = this.#init();
  }

  static async create(options?: SyncOpfsOptions) {
    const instance = new SyncOPFS(options || {});
    await instance.readyPromise;
    return instance;
  }

  async #init() {
    // Due to a quirk in tsup/esbuild we have to specify the worker url relative to
    // the root of the dist directory
    this.#worker = new Worker(
      new URL("./fs/opfs/syncOPFS/worker.js", import.meta.url),
      {
        type: "module",
      },
    );

    // Wait for the worker to send a message to indicate that it is ready
    await new Promise<void>((resolve) => {
      this.#worker!.addEventListener(
        "message",
        (event) => {
          if (event.data.type === "here") {
            resolve();
          } else {
            throw new Error("Unexpected message from worker");
          }
        },
        { once: true },
      );
    });

    // Send the buffers to the worker
    this.#worker.postMessage({
      type: "init",
      controlBuffer: this.#controlBuffer,
      callBuffer: this.#callBuffer,
      responseBuffer: this.#responseBuffer,
      sharedBuffers: this.#sharedBuffers,
    });

    // Wait for the worker to send a message to indicate that it is ready
    await new Promise<void>((resolve) => {
      this.#worker!.addEventListener(
        "message",
        (event) => {
          if (event.data.type === "ready") {
            resolve();
          } else {
            throw new Error("Unexpected message from worker");
          }
        },
        { once: true },
      );
    });

    this.#ready = true;
  }

  get ready() {
    return this.#ready;
  }

  #encodeArgs(method: string, args: any[]) {
    const convertedArgs = args.map((arg) => {
      if (arg instanceof SharedArrayBuffer) {
        return this.#sharedBuffers.indexOf(arg);
      } else {
        return arg;
      }
    });
    return new TextEncoder().encode(
      JSON.stringify({
        method,
        args: convertedArgs,
      } satisfies CallMsg),
    );
  }

  #waitForState(state: number | number[]) {
    return waitFor(this.#controlArray, slot.STATE, state);
  }

  #setState(state: number) {
    this.#controlArray[slot.STATE] = state;
    Atomics.notify(this.#controlArray, slot.STATE);
  }

  #callSync(method: string, args: any[], next?: () => void) {
    // Serialize the arguments
    const argsBuffer = this.#encodeArgs(method, args);
    if (argsBuffer.byteLength > this.#callArray.byteLength) {
      throw new Error("Arguments too large");
    }
    this.#callArray.set(argsBuffer);
    this.#controlArray[slot.CALL_LENGTH] = argsBuffer.byteLength;

    // Set the state to CALL
    this.#setState(states.CALL);

    // Wait for the worker to set the state to RESPONSE using Atomics.wait
    while (true) {
      const state = this.#waitForState([states.RESPONSE, states.ASK_NEXT]);
      if (state === states.RESPONSE) {
        break;
      }
      // Perform the next operation, this could be a chunked read/write
      next?.();
      this.#setState(states.SEND_NEXT);
    }

    // Deserialize the response
    const responseBuffer = this.#responseArray.slice(
      0,
      this.#controlArray[slot.RESPONSE_LENGTH],
    );
    const response: ResponseJson = JSON.parse(
      new TextDecoder().decode(responseBuffer),
    );
    if ("error" in response) {
      throw new FsError(
        response.error.code,
        response.error.message +
          (response.error.code !== undefined
            ? ` (${response.error.code})`
            : ""),
      );
    }
    return response.value;
  }

  close(fd: number): void {
    return this.#callSync("close", [fd]);
  }

  fstat(fd: number): FsStats {
    return this.#callSync("fstat", [fd]);
  }

  lstat(path: string): FsStats {
    const ret: FsStats = this.#callSync("lstat", [path]);
    if (path.endsWith("/global/pg_control")) {
      ret.mode = 33184; // HACK!
    }
    return ret;
  }

  mkdir(path: string, options?: { recursive?: boolean; mode?: number }): void {
    return this.#callSync("mkdir", [path, options]);
  }

  open(path: string, flags?: string, mode?: number): number {
    return this.#callSync("open", [path, flags, mode]);
  }

  readdir(path: string): string[] {
    return this.#callSync("readdir", [path]);
  }

  read(
    fd: number,
    buffer: Int8Array, // Buffer to read into
    offset: number, // Offset in buffer to start writing to
    length: number, // Number of bytes to read
    position: number, // Position in file to read from
  ): number {
    if (
      buffer instanceof SharedArrayBuffer &&
      this.#sharedBuffers.includes(buffer)
    ) {
      return this.#callSync("read", [fd, buffer, offset, length, position]);
    } else {
      let read = 0;
      const ret = this.#callSync(
        "read",
        [fd, -1, offset, length, position],
        () => {
          // Read the chunk from the responseBuffer in chunks the size of the responseBuffer
          const chunkLength = Math.min(
            this.#responseBuffer.byteLength,
            length - read,
          );
          const sourceArray = new Int8Array(
            this.#responseArray.buffer,
            0,
            chunkLength,
          );
          buffer.set(sourceArray, offset + read);
          read += this.#controlArray[slot.RESPONSE_LENGTH];
        },
      );
      return ret;
    }
  }

  rename(oldPath: string, newPath: string): void {
    return this.#callSync("rename", [oldPath, newPath]);
  }

  rmdir(path: string): void {
    return this.#callSync("rmdir", [path]);
  }

  truncate(path: string, len: number): void {
    return this.#callSync("truncate", [path, len]);
  }

  unlink(path: string): void {
    return this.#callSync("unlink", [path]);
  }

  writeFile(
    path: string,
    data: string,
    options?: { encoding: string; mode: number; flag: string },
  ): void {
    return this.#callSync("writeFile", [path, data, options]);
    // const fd = this.open(path, "w");
    // const bin = new TextEncoder().encode(data) as any as Int8Array
    // this.write(fd, bin, 0, bin.length, 0);
    // this.close(fd);
  }

  write(
    fd: number,
    buffer: Int8Array, // Buffer to read from
    offset: number, // Offset in buffer to start reading from
    length: number, // Number of bytes to write
    position: number, // Position in file to write to
  ): number {
    if (
      buffer instanceof SharedArrayBuffer &&
      this.#sharedBuffers.includes(buffer)
    ) {
      return this.#callSync("write", [fd, buffer, offset, length, position]);
    } else {
      // Write the chunk to the callBuffer in chunks the size of the callBuffer
      let written = 0;
      return this.#callSync("write", [fd, -1, offset, length, position], () => {
        const chunkLength = Math.min(
          this.#callArray.byteLength,
          length - written,
        );
        let view = new Uint8Array(buffer, offset + written, chunkLength);
        if (view.length !== chunkLength) {
          // TODO: I don't know why this is needed, sometimes the view is a different length
          view = new Uint8Array(view.buffer, view.byteOffset, chunkLength);
        }
        this.#callArray.set(view, 0);
        written += chunkLength;
      });
    }
  }

  exit(): void {
    this.#worker!.terminate();
  }
}
