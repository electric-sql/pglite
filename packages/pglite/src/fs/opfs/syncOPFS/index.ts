import { states, slot, type FsStats, type ResponseJson } from "./types";

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

    this.#callBuffer = new SharedArrayBuffer(callBufferSize || 8192); // Default: 8KB
    this.#callArray = new Uint8Array(this.#callBuffer);

    this.#responseBuffer = new SharedArrayBuffer(responseBufferSize || 8192); // Default: 8KB
    this.#responseArray = new Uint8Array(this.#responseBuffer);

    // Set up the control array
    this.#controlArray[slot.STATE] = states.IDLE; // state
    this.#controlArray[slot.CALL_LENGTH] = 0; // callLength
    this.#controlArray[slot.RESPONSE_LENGTH] = 0; // responseLength

    this.readyPromise = this.#init();
  }

  static async create(options: SyncOpfsOptions) {
    const instance = new SyncOPFS(options);
    await instance.readyPromise;
    return instance;
  }

  async #init() {
    this.#worker = new Worker(new URL("./worker.ts", import.meta.url), {
      type: "module",
    });

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
        { once: true }
      );
    });

    // Send the buffers to the worker
    this.#worker.postMessage(
      {
        type: "init",
        controlBuffer: this.#controlBuffer,
        callBuffer: this.#callBuffer,
        responseBuffer: this.#responseBuffer,
        sharedBuffers: this.#sharedBuffers,
      },
      [
        this.#controlBuffer,
        this.#callBuffer,
        this.#responseBuffer,
        ...this.#sharedBuffers,
      ]
    );

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
        { once: true }
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
      })
    );
  }

  #callSync(method: string, args: any[]) {
    // Serialize the arguments
    const argsBuffer = this.#encodeArgs(method, args);
    if (argsBuffer.byteLength > this.#callArray.byteLength) {
      throw new Error("Arguments too large");
    }
    this.#callArray.set(argsBuffer);
    this.#controlArray[slot.CALL_LENGTH] = argsBuffer.byteLength;

    // Set the state to CALL
    this.#controlArray[slot.STATE] = states.CALL;

    // Wait for the worker to set the state to RESPONSE using Atomics.wait
    Atomics.wait(this.#controlArray, slot.STATE, states.RESPONSE);

    // Deserialize the response
    const responseBuffer = this.#responseArray.slice(0, this.#controlArray[2]);
    const response: ResponseJson = JSON.parse(
      new TextDecoder().decode(responseBuffer)
    );
    if ("error" in response) {
      throw new Error(
        response.error.message + response.error.code !== undefined
          ? ` (${response.error.code})`
          : ""
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
    return this.#callSync("lstat", [path]);
  }

  mkdir(path: string, options?: { recursive: boolean; mode: number }): void {
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
    buffer: SharedArrayBuffer | ArrayBuffer,
    offset: number,
    length: number,
    position: number
  ): number {
    if (buffer instanceof SharedArrayBuffer) {
      return this.#callSync("read", [fd, buffer, offset, length, position]);
    } else {
      // TODO
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
    options?: { encoding: string; mode: number; flag: string }
  ): void {
    return this.#callSync("writeFile", [path, data, options]);
  }

  write(
    fd: number,
    buffer: SharedArrayBuffer | ArrayBuffer,
    offset: number,
    length: number,
    position: number
  ): number {
    if (buffer instanceof SharedArrayBuffer) {
      return this.#callSync("write", [fd, buffer, offset, length, position]);
    } else {
      // TODO
    }
  }

  exit(): void {
    this.#worker!.terminate();
  }
}
