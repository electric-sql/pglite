/** Based on https://github.com/DefinitelyTyped/DefinitelyTyped/blob/master/types/emscripten/index.d.ts */
/** Other WebAssembly declarations, for compatibility with older versions of Typescript */
declare namespace WebAssembly {
  interface Module {}
}

declare namespace Emscripten {
  interface FileSystemType {}
  type EnvironmentType = "WEB" | "NODE" | "SHELL" | "WORKER";

  type JSType = "number" | "string" | "array" | "boolean";
  type TypeCompatibleWithC = number | string | any[] | boolean;

  type CIntType = "i8" | "i16" | "i32" | "i64";
  type CFloatType = "float" | "double";
  type CPointerType =
    | "i8*"
    | "i16*"
    | "i32*"
    | "i64*"
    | "float*"
    | "double*"
    | "*";
  type CType = CIntType | CFloatType | CPointerType;

  type WebAssemblyImports = Array<{
    name: string;
    kind: string;
  }>;

  type WebAssemblyExports = Array<{
    module: string;
    name: string;
    kind: string;
  }>;

  interface CCallOpts {
    async?: boolean | undefined;
  }
}

export interface EmscriptenModule {
  print(str: string): void;
  printErr(str: string): void;
  arguments: string[];
  environment: Emscripten.EnvironmentType;
  preInit: Array<{ (mod: EmscriptenModule): void }>;
  preRun: Array<{ (mod: EmscriptenModule): void }>;
  postRun: Array<{ (mod: EmscriptenModule): void }>;
  onAbort: { (what: any): void };
  onRuntimeInitialized: { (): void };
  preinitializedWebGLContext: WebGLRenderingContext;
  noInitialRun: boolean;
  noExitRuntime: boolean;
  logReadFiles: boolean;
  filePackagePrefixURL: string;
  wasmBinary: ArrayBuffer;

  destroy(object: object): void;
  getPreloadedPackage(
    remotePackageName: string,
    remotePackageSize: number
  ): ArrayBuffer;
  instantiateWasm(
    imports: Emscripten.WebAssemblyImports,
    successCallback: (module: WebAssembly.Module) => void
  ): Emscripten.WebAssemblyExports;
  locateFile(url: string, scriptDirectory: string): string;
  onCustomMessage(event: MessageEvent): void;

  // USE_TYPED_ARRAYS == 1
  HEAP: Int32Array;
  IHEAP: Int32Array;
  FHEAP: Float64Array;

  // USE_TYPED_ARRAYS == 2
  HEAP8: Int8Array;
  HEAP16: Int16Array;
  HEAP32: Int32Array;
  HEAPU8: Uint8Array;
  HEAPU16: Uint16Array;
  HEAPU32: Uint32Array;
  HEAPF32: Float32Array;
  HEAPF64: Float64Array;
  HEAP64: BigInt64Array;
  HEAPU64: BigUint64Array;

  TOTAL_STACK: number;
  TOTAL_MEMORY: number;
  FAST_MEMORY: number;

  addOnPreRun(cb: () => any): void;
  addOnInit(cb: () => any): void;
  addOnPreMain(cb: () => any): void;
  addOnExit(cb: () => any): void;
  addOnPostRun(cb: () => any): void;

  preloadedImages: any;
  preloadedAudios: any;

  _malloc(size: number): number;
  _free(ptr: number): void;
}

/**
 * A factory function is generated when setting the `MODULARIZE` build option
 * to `1` in your Emscripten build. It return a Promise that resolves to an
 * initialized, ready-to-call `EmscriptenModule` instance.
 *
 * By default, the factory function will be named `Module`. It's recommended to
 * use the `EXPORT_ES6` option, in which the factory function will be the
 * default export. If used without `EXPORT_ES6`, the factory function will be a
 * global variable. You can rename the variable using the `EXPORT_NAME` build
 * option. It's left to you to declare any global variables as needed in your
 * application's types.
 * @param moduleOverrides Default properties for the initialized module.
 */
type EmscriptenModuleFactory<T extends EmscriptenModule = EmscriptenModule> = (
  moduleOverrides?: Partial<T>
) => Promise<T>;

export interface FS {
  Lookup: {
    path: string;
    node: FSNode;
  };

  FSStream: {};
  FSNode: {};
  ErrnoError: {};

  ignorePermissions: boolean;
  trackingDelegate: any;
  tracking: any;
  genericErrors: any;

  filesystems: {
    NODEFS: Emscripten.FileSystemType;
    MEMFS: Emscripten.FileSystemType;
    IDBFS: Emscripten.FileSystemType;
  };

  //
  // paths
  //
  lookupPath(path: string, opts: any): Lookup;
  getPath(node: FSNode): string;

  //
  // nodes
  //
  isFile(mode: number): boolean;
  isDir(mode: number): boolean;
  isLink(mode: number): boolean;
  isChrdev(mode: number): boolean;
  isBlkdev(mode: number): boolean;
  isFIFO(mode: number): boolean;
  isSocket(mode: number): boolean;

  //
  // devices
  //
  major(dev: number): number;
  minor(dev: number): number;
  makedev(ma: number, mi: number): number;
  registerDevice(dev: number, ops: any): void;

  //
  // core
  //
  syncfs(populate: boolean, callback: (e: any) => any): void;
  syncfs(callback: (e: any) => any, populate?: boolean): void;
  mount(type: Emscripten.FileSystemType, opts: any, mountpoint: string): any;
  unmount(mountpoint: string): void;

  mkdir(path: string, mode?: number): any;
  mkdev(path: string, mode?: number, dev?: number): any;
  symlink(oldpath: string, newpath: string): any;
  rename(old_path: string, new_path: string): void;
  rmdir(path: string): void;
  readdir(path: string): any;
  unlink(path: string): void;
  readlink(path: string): string;
  stat(path: string, dontFollow?: boolean): any;
  lstat(path: string): any;
  chmod(path: string, mode: number, dontFollow?: boolean): void;
  lchmod(path: string, mode: number): void;
  fchmod(fd: number, mode: number): void;
  chown(path: string, uid: number, gid: number, dontFollow?: boolean): void;
  lchown(path: string, uid: number, gid: number): void;
  fchown(fd: number, uid: number, gid: number): void;
  truncate(path: string, len: number): void;
  ftruncate(fd: number, len: number): void;
  utime(path: string, atime: number, mtime: number): void;
  open(
    path: string,
    flags: string,
    mode?: number,
    fd_start?: number,
    fd_end?: number
  ): FSStream;
  close(stream: FSStream): void;
  llseek(stream: FSStream, offset: number, whence: number): any;
  read(
    stream: FSStream,
    buffer: ArrayBufferView,
    offset: number,
    length: number,
    position?: number
  ): number;
  write(
    stream: FSStream,
    buffer: ArrayBufferView,
    offset: number,
    length: number,
    position?: number,
    canOwn?: boolean
  ): number;
  allocate(stream: FSStream, offset: number, length: number): void;
  mmap(
    stream: FSStream,
    buffer: ArrayBufferView,
    offset: number,
    length: number,
    position: number,
    prot: number,
    flags: number
  ): any;
  ioctl(stream: FSStream, cmd: any, arg: any): any;
  readFile(
    path: string,
    opts: { encoding: "binary"; flags?: string | undefined }
  ): Uint8Array;
  readFile(
    path: string,
    opts: { encoding: "utf8"; flags?: string | undefined }
  ): string;
  readFile(path: string, opts?: { flags?: string | undefined }): Uint8Array;
  writeFile(
    path: string,
    data: string | ArrayBufferView,
    opts?: { flags?: string | undefined }
  ): void;

  //
  // module-level FS code
  //
  cwd(): string;
  chdir(path: string): void;
  init(
    input: null | (() => number | null),
    output: null | ((c: number) => any),
    error: null | ((c: number) => any)
  ): void;

  createLazyFile(
    parent: string | FSNode,
    name: string,
    url: string,
    canRead: boolean,
    canWrite: boolean
  ): FSNode;
  createPreloadedFile(
    parent: string | FSNode,
    name: string,
    url: string,
    canRead: boolean,
    canWrite: boolean,
    onload?: () => void,
    onerror?: () => void,
    dontCreateFile?: boolean,
    canOwn?: boolean
  ): void;
  createDataFile(
    parent: string | FSNode,
    name: string,
    data: ArrayBufferView,
    canRead: boolean,
    canWrite: boolean,
    canOwn: boolean
  ): FSNode;
}

declare var MEMFS: Emscripten.FileSystemType;
declare var NODEFS: Emscripten.FileSystemType;
declare var IDBFS: Emscripten.FileSystemType;

// https://emscripten.org/docs/porting/connecting_cpp_and_javascript/Interacting-with-code.html
type StringToType<R extends any> = R extends Emscripten.JSType
  ? {
      number: number;
      string: string;
      array: number[] | string[] | boolean[] | Uint8Array | Int8Array;
      boolean: boolean;
      null: null;
    }[R]
  : never;

type ArgsToType<T extends Array<Emscripten.JSType | null>> = Extract<
  {
    [P in keyof T]: StringToType<T[P]>;
  },
  any[]
>;

type ReturnToType<R extends Emscripten.JSType | null> = R extends null
  ? null
  : StringToType<Exclude<R, null>>;

// Below runtime function/variable declarations are exportable by
// -s EXTRA_EXPORTED_RUNTIME_METHODS. You can extend or merge
// EmscriptenModule interface to add runtime functions.
//
// For example, by using -s "EXTRA_EXPORTED_RUNTIME_METHODS=['ccall']"
// You can access ccall() via Module["ccall"]. In this case, you should
// extend EmscriptenModule to pass the compiler check like the following:
//
// interface YourOwnEmscriptenModule extends EmscriptenModule {
//     ccall: typeof ccall;
// }
//
// See: https://emscripten.org/docs/getting_started/FAQ.html#why-do-i-get-typeerror-module-something-is-not-a-function

declare function cwrap<
  I extends Array<Emscripten.JSType | null> | [],
  R extends Emscripten.JSType | null
>(
  ident: string,
  returnType: R,
  argTypes: I,
  opts?: Emscripten.CCallOpts
): (...arg: ArgsToType<I>) => ReturnToType<R>;

declare function ccall<
  I extends Array<Emscripten.JSType | null> | [],
  R extends Emscripten.JSType | null
>(
  ident: string,
  returnType: R,
  argTypes: I,
  args: ArgsToType<I>,
  opts?: Emscripten.CCallOpts
): ReturnToType<R>;

declare function setValue(
  ptr: number,
  value: any,
  type: Emscripten.CType,
  noSafe?: boolean
): void;
declare function getValue(
  ptr: number,
  type: Emscripten.CType,
  noSafe?: boolean
): number;

declare function allocate(
  slab: number[] | ArrayBufferView | number,
  types: Emscripten.CType | Emscripten.CType[],
  allocator: number,
  ptr?: number
): number;

declare function stackAlloc(size: number): number;
declare function stackSave(): number;
declare function stackRestore(ptr: number): void;

declare function UTF8ToString(ptr: number, maxBytesToRead?: number): string;
declare function stringToUTF8(
  str: string,
  outPtr: number,
  maxBytesToRead?: number
): void;
declare function lengthBytesUTF8(str: string): number;
declare function allocateUTF8(str: string): number;
declare function allocateUTF8OnStack(str: string): number;
declare function UTF16ToString(ptr: number): string;
declare function stringToUTF16(
  str: string,
  outPtr: number,
  maxBytesToRead?: number
): void;
declare function lengthBytesUTF16(str: string): number;
declare function UTF32ToString(ptr: number): string;
declare function stringToUTF32(
  str: string,
  outPtr: number,
  maxBytesToRead?: number
): void;
declare function lengthBytesUTF32(str: string): number;

declare function intArrayFromString(
  stringy: string,
  dontAddNull?: boolean,
  length?: number
): number[];
declare function intArrayToString(array: number[]): string;
declare function writeStringToMemory(
  str: string,
  buffer: number,
  dontAddNull: boolean
): void;
declare function writeArrayToMemory(array: number[], buffer: number): void;
declare function writeAsciiToMemory(
  str: string,
  buffer: number,
  dontAddNull: boolean
): void;

declare function addRunDependency(id: any): void;
declare function removeRunDependency(id: any): void;

declare function addFunction(
  func: (...args: any[]) => any,
  signature?: string
): number;
declare function removeFunction(funcPtr: number): void;

declare var ALLOC_NORMAL: number;
declare var ALLOC_STACK: number;
declare var ALLOC_STATIC: number;
declare var ALLOC_DYNAMIC: number;
declare var ALLOC_NONE: number;

export interface EmPostgres extends EmscriptenModule {
  FS: FS;
  eventTarget: EventTarget;
  Event: typeof CustomEvent;
  onRuntimeInitialized: (Module: EmPostgres) => Promise<void>;
}

function EmPostgresFactory(
  opts?: Partial<EmPostgres>,
  __dirname?: any,
  require?: (string) => any
): Promise<EmPostgres>;

export default EmPostgresFactory;
