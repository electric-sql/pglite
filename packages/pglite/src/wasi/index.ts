import defs from './defs.js'
import { FSInterface, FileDescriptor, WASIOptions } from './types'

export { defs }
export * from './types'

export class WASIProcExit extends Error {
  code: number

  constructor(code: number) {
    super(`Exit with code ${code}`)
    this.code = code
  }
}

export class FSDummy implements FSInterface {
  appendFileSync(
    _path: string,
    _data: Uint8Array | string,
    _options: any = {},
  ): void {
    throw new Error('appendFileSync not implemented. This is a dummy fs.')
  }

  fsyncSync(_fd: number | string): void {
    throw new Error('fsyncSync not implemented. This is a dummy fs.')
  }

  linkSync(_existingPath: string, _newPath: string): void {
    throw new Error('linkSync not implemented. This is a dummy fs.')
  }

  mkdirSync(_path: string, _options: any = {}): void {
    throw new Error('mkdirSync not implemented. This is a dummy fs.')
  }

  readdirSync(_path: string, _options: any = {}): any[] {
    throw new Error('readdirSync not implemented. This is a dummy fs.')
  }

  readFileSync(_path: string, _options: any = {}): Uint8Array {
    throw new Error('readFileSync not implemented. This is a dummy fs.')
  }

  readlinkSync(_path: string, _options: any = {}): string {
    throw new Error('readlinkSync not implemented. This is a dummy fs.')
  }

  renameSync(_oldPath: string, _newPath: string): void {
    throw new Error('renameSync not implemented. This is a dummy fs.')
  }

  rmdirSync(_path: string, _options: any = {}): void {
    throw new Error('rmdirSync not implemented. This is a dummy fs.')
  }

  setFlagsSync(_path: string, _flags: number): void {
    throw new Error('setFlagsSync not implemented. This is a dummy fs.')
  }

  statSync(_path: string, _options: any = {}): any {
    throw new Error('statSync not implemented. This is a dummy fs.')
  }

  symlinkSync(_target: string, _path: string, _type: string = 'file'): void {
    throw new Error('symlinkSync not implemented. This is a dummy fs.')
  }

  truncateSync(_path: string, _len: number = 0): void {
    throw new Error('truncateSync not implemented. This is a dummy fs.')
  }

  unlinkSync(_path: string): void {
    throw new Error('unlinkSync not implemented. This is a dummy fs.')
  }

  utimesSync(_path: string, _atime: number, _mtime: number): void {
    throw new Error('utimesSync not implemented. This is a dummy fs.')
  }

  writeFileSync(
    _path: string,
    _data: Uint8Array | string,
    _options: any = {},
  ): void {
    throw new Error('writeFileSync not implemented. This is a dummy fs.')
  }
}

export class WasiPreview1 {
  private args: string[]
  private env: Record<string, string>
  private fs: FSInterface
  private debug: boolean
  private fds: Map<number, FileDescriptor>
  private nextFd: number
  private textDecoder: TextDecoder
  private textEncoder: TextEncoder
  private wasm: any // Type for WebAssembly instance - could be more specific

  constructor(options: WASIOptions = {}) {
    this.args = options?.args || []
    this.env = options?.env || {}
    this.fs = options?.fs || new FSDummy()
    this.debug = !!options?.debug

    // Initialize file descriptors with stdin(0), stdout(1), stderr(2), /
    // fd is first number
    this.fds = new Map([
      [0, { fd: 0, type: 'stdio' }], // stdin
      [1, { fd: 1, type: 'stdio' }], // stdout
      [2, { fd: 2, type: 'stdio' }], // stderr
      [
        3,
        { fd: 3, type: 'directory', preopenPath: '/', handle: { path: '/' } },
      ], // root directory
    ])

    this.nextFd = this.fds.size
    this.textDecoder = new TextDecoder()
    this.textEncoder = new TextEncoder()

    // Bind all WASI functions to maintain correct 'this' context
    const doBind = (...names: (keyof WasiPreview1)[]) => {
      // TODO: there is probably a better way to do this
      for (const name of names) {
        if (this.debug) {
          const orig: (...args: any[]) => any = this[name].bind(this)
          this[name] = ((...args: any[]) => {
            console.log(name, args)
            return orig(...args)
          }) as any
        } else {
          this[name] = this[name].bind(this) as any
        }
      }
    }
    doBind(
      'args_get',
      'args_sizes_get',
      'environ_get',
      'environ_sizes_get',
      'clock_res_get',
      'clock_time_get',
      'fd_close',
      'fd_seek',
      'fd_write',
      'fd_read',
      'fd_fdstat_get',
      'fd_fdstat_set_flags',
      'fd_filestat_get',
      'fd_prestat_get',
      'fd_prestat_dir_name',
      'path_open',
      'path_filestat_get',
      'proc_exit',
      'fd_advise',
      'fd_allocate',
      'fd_datasync',
      'fd_filestat_set_size',
      'fd_filestat_set_times',
      'fd_pread',
      'fd_pwrite',
      'fd_readdir',
      'fd_renumber',
      'fd_sync',
      'fd_tell',
      'path_create_directory',
      'path_filestat_set_times',
      'path_link',
      'path_readlink',
      'path_remove_directory',
      'path_rename',
      'path_symlink',
      'path_unlink_file',
      'poll_oneoff',
      'sock_accept',
      'sock_recv',
      'sock_send',
      'sock_shutdown',
      'random_get',
      'sched_yield',
    )
  }

  // Helper methods

  // this binds the wasm to this WASI implementation
  setup(wasm: any): void {
    this.wasm = wasm
  }

  // this binds the wasm to this WASI implementation
  // and calls it's main()'
  start(wasm: any): number {
    this.setup(wasm)
    try {
      if (wasm._start) {
        wasm._start()
      }
      return 0
    } catch (e) {
      if (e instanceof WASIProcExit) {
        return e.code
      }
      throw e
    }
  }

  private allocateFd(
    fileHandle: any,
    type: 'file' | 'directory' = 'file',
  ): number {
    const fd = this.nextFd++
    const descriptor: FileDescriptor = { type, handle: fileHandle, fd }
    this.fds.set(fd, descriptor)
    return fd
  }

  // Standard input (for fd_read)
  stdin(): Uint8Array {
    return new Uint8Array()
  }

  // Standard output handling (for fd_write)
  stdout(buffer: Uint8Array): void {
    const text = this.textDecoder.decode(buffer).replace(/\n$/g, '')
    if (text) console.log(text)
  }

  // Standard error handling (for fd_write)
  stderr(buffer: Uint8Array): void {
    const text = this.textDecoder.decode(buffer).replace(/\n$/g, '')
    if (text) console.error(text)
  }

  // Args functions
  args_get(argvP: number, argvBufP: number): number {
    const view = new DataView(this.wasm.memory.buffer)
    const mem = new Uint8Array(this.wasm.memory.buffer)

    for (const arg of this.args) {
      view.setUint32(argvP, argvBufP, true)
      argvP += 4
      const encoded = this.textEncoder.encode(arg)
      mem.set(encoded, argvBufP)
      mem[argvBufP + encoded.length] = 0 // null terminator
      argvBufP += encoded.length + 1
    }
    return defs.ERRNO_SUCCESS
  }

  args_sizes_get(argcPtr: number, argvBufSizePtr: number): number {
    const view = new DataView(this.wasm.memory.buffer)
    view.setUint32(argcPtr, this.args.length, true)
    const bufSize = this.args.reduce((acc, arg) => acc + arg.length + 1, 0)
    view.setUint32(argvBufSizePtr, bufSize, true)
    return defs.ERRNO_SUCCESS
  }

  // Environment functions
  environ_get(environP: number, environBufP: number): number {
    const view = new DataView(this.wasm.memory.buffer)
    const mem = new Uint8Array(this.wasm.memory.buffer)

    for (const [key, value] of Object.entries(this.env)) {
      view.setUint32(environP, environBufP, true)
      environP += 4
      const entry = `${key}=${value}\0`
      const encoded = this.textEncoder.encode(entry)
      mem.set(encoded, environBufP)
      environBufP += encoded.length
    }
    return defs.ERRNO_SUCCESS
  }

  environ_sizes_get(
    environCountPtr: number,
    environBufSizePtr: number,
  ): number {
    const view = new DataView(this.wasm.memory.buffer)
    const count = Object.keys(this.env).length
    view.setUint32(environCountPtr, count, true)
    const bufSize = Object.entries(this.env).reduce(
      (acc, [k, v]) => acc + k.length + v.length + 2,
      0,
    )
    view.setUint32(environBufSizePtr, bufSize, true)
    return defs.ERRNO_SUCCESS
  }

  // Clock functions
  clock_res_get(id: number, resPtr: number): number {
    const view = new DataView(this.wasm.memory.buffer)
    let resolution
    switch (id) {
      case defs.CLOCKID_REALTIME:
        resolution = 1_000_000n // 1ms in nanoseconds
        break
      case defs.CLOCKID_MONOTONIC:
        resolution = 1_000n // 1μs in nanoseconds
        break
      default:
        return defs.ERRNO_INVAL
    }
    view.setBigUint64(resPtr, resolution, true)
    return defs.ERRNO_SUCCESS
  }

  fd_filestat_get(fd: number, filestatPtr: number): number {
    const fileDesc = this.fds.get(fd)
    if (!fileDesc) return defs.ERRNO_BADF

    try {
      let stats
      if (fileDesc.type === 'stdio') {
        // For stdio, return minimal stats
        stats = {
          dev: 0n,
          ino: 0n,
          filetype: defs.FILETYPE_CHARACTER_DEVICE,
          nlink: 1n,
          size: 0n,
          atim: 0n,
          mtim: 0n,
          ctim: 0n,
        }
      } else if (fileDesc.type === 'file' || fileDesc.type === 'directory') {
        // Get actual file stats
        const fsStats = this.fs.statSync(fileDesc.handle.path)

        // Determine file type
        let filetype: number = defs.FILETYPE_UNKNOWN
        if (fsStats.isFile()) filetype = defs.FILETYPE_REGULAR_FILE
        else if (fsStats.isDirectory()) filetype = defs.FILETYPE_DIRECTORY
        else if (fsStats.isSymbolicLink())
          filetype = defs.FILETYPE_SYMBOLIC_LINK
        else if (fsStats.isCharacterDevice())
          filetype = defs.FILETYPE_CHARACTER_DEVICE
        else if (fsStats.isBlockDevice()) filetype = defs.FILETYPE_BLOCK_DEVICE
        else if (fsStats.isFIFO()) filetype = defs.FILETYPE_SOCKET_STREAM

        stats = {
          dev: BigInt(fsStats.dev || 0),
          ino: BigInt(fsStats.ino || 0),
          filetype,
          nlink: BigInt(fsStats.nlink || 1),
          size: BigInt(fsStats.size || 0),
          atim: BigInt(fsStats.atimeMs * 1_000_000), // Convert to nanoseconds
          mtim: BigInt(fsStats.mtimeMs * 1_000_000),
          ctim: BigInt(fsStats.ctimeMs * 1_000_000),
        }
      } else {
        return defs.ERRNO_BADF
      }

      // Write filestat struct to memory
      const view = new DataView(this.wasm.memory.buffer)

      // device ID - u64
      view.setBigUint64(filestatPtr, stats.dev, true)

      // inode - u64
      view.setBigUint64(filestatPtr + 8, stats.ino, true)

      // filetype - u8
      view.setUint8(filestatPtr + 16, stats.filetype)

      // nlink - u64
      view.setBigUint64(filestatPtr + 24, stats.nlink, true)

      // size - u64
      view.setBigUint64(filestatPtr + 32, stats.size, true)

      // atime - u64
      view.setBigUint64(filestatPtr + 40, stats.atim, true)

      // mtime - u64
      view.setBigUint64(filestatPtr + 48, stats.mtim, true)

      // ctime - u64
      view.setBigUint64(filestatPtr + 56, stats.ctim, true)

      return defs.ERRNO_SUCCESS
    } catch (e) {
      return defs.ERRNO_IO
    }
  }

  clock_time_get(id: number, _precision: number, timePtr: number): number {
    const view = new DataView(this.wasm.memory.buffer)
    let time
    switch (id) {
      case defs.CLOCKID_REALTIME: {
        const ms = Date.now()
        time = BigInt(ms) * 1_000_000n
        break
      }
      case defs.CLOCKID_MONOTONIC: {
        const ns = BigInt(Math.round(performance.now() * 1_000_000))
        time = ns
        break
      }
      default:
        return defs.ERRNO_INVAL
    }
    view.setBigUint64(timePtr, time, true)
    return defs.ERRNO_SUCCESS
  }

  fd_close(fd: number): number {
    const fileDesc = this.fds.get(fd)
    if (!fileDesc) return defs.ERRNO_BADF
    this.fds.delete(fd)
    return defs.ERRNO_SUCCESS
  }

  fd_seek(
    fd: number,
    offset: number,
    whence: number,
    newOffsetPtr: number,
  ): number {
    const fileDesc = this.fds.get(fd)
    if (!fileDesc) return defs.ERRNO_BADF
    if (fileDesc.type === 'stdio') return defs.ERRNO_SPIPE
    if (fileDesc.type === 'directory') return defs.ERRNO_BADF

    let stats = null
    let newPosition = 0
    const noffset = Number(offset)

    try {
      stats = this.fs.statSync(fileDesc.handle.path)
    } catch (e) {
      return defs.ERRNO_IO
    }

    switch (whence) {
      case defs.WHENCE_SET:
        newPosition = noffset
        break
      case defs.WHENCE_CUR:
        newPosition = Number(fileDesc.handle.position) + noffset
        break
      case defs.WHENCE_END:
        newPosition = Number(stats.size) + noffset
        break
      default:
        return defs.ERRNO_INVAL
    }

    // Update position
    fileDesc.handle.position = newPosition

    const view = new DataView(this.wasm.memory.buffer)
    view.setBigUint64(newOffsetPtr, BigInt(newPosition), true)
    return defs.ERRNO_SUCCESS
  }

  fd_write(
    fd: number,
    iovs: number,
    iovsLen: number,
    nwrittenPtr: number,
  ): number {
    let written = 0
    const chunks = []
    const view = new DataView(this.wasm.memory.buffer)
    const mem = new Uint8Array(this.wasm.memory.buffer)

    // Gather all the chunks from the vectors
    for (let i = 0; i < iovsLen; i++) {
      const ptr = iovs + i * 8
      const buf = view.getUint32(ptr, true)
      const bufLen = view.getUint32(ptr + 4, true)
      chunks.push(new Uint8Array(mem.buffer, buf, bufLen))
      written += bufLen
    }

    // Concatenate chunks if needed
    let buffer
    if (chunks.length === 1) {
      buffer = chunks[0]
    } else {
      buffer = new Uint8Array(written)
      let offset = 0
      for (const chunk of chunks) {
        buffer.set(chunk, offset)
        offset += chunk.length
      }
    }

    // Handle standard streams
    if (fd === 1) {
      this.stdout(buffer)
    } else if (fd === 2) {
      this.stderr(buffer)
    } else {
      const fileDesc = this.fds.get(fd)
      if (!fileDesc || fileDesc.type !== 'file') {
        return defs.ERRNO_BADF
      }
      fileDesc.handle.position += written
      try {
        // Write using ZenFS path-based API
        this.fs.writeFileSync(fileDesc.handle.path, buffer)
      } catch (e) {
        return defs.ERRNO_IO
      }
    }

    view.setUint32(nwrittenPtr, written, true)
    return defs.ERRNO_SUCCESS
  }

  fd_read(fd: number, iovs: number, iovsLen: number, nreadPtr: number): number {
    const fileDesc = this.fds.get(fd)
    if (!fileDesc) return defs.ERRNO_BADF
    if (fileDesc.type === 'directory') return defs.ERRNO_BADF

    let totalRead = 0
    const view = new DataView(this.wasm.memory.buffer)
    const mem = new Uint8Array(this.wasm.memory.buffer)

    try {
      let content
      if (fd === 0) {
        content = this.stdin()
      } else if (fileDesc.type === 'file') {
        content = this.fs.readFileSync(fileDesc.handle.path)
      } else {
        return defs.ERRNO_BADF
      }

      for (let i = 0; i < iovsLen; i++) {
        const ptr = iovs + i * 8
        const buf = view.getUint32(ptr, true)
        const bufLen = view.getUint32(ptr + 4, true)

        const start = fileDesc.type === 'stdio' ? 0 : fileDesc.handle.position
        const end = Math.min(start + bufLen, content.length)
        const bytesToRead = end - start

        if (bytesToRead <= 0) break

        mem.set(new Uint8Array(content.slice(start, end)), buf)
        totalRead += bytesToRead
        if (fileDesc.type === 'file') {
          fileDesc.handle.position += bytesToRead
        }

        if (bytesToRead < bufLen) break
      }

      view.setUint32(nreadPtr, totalRead, true)
      return defs.ERRNO_SUCCESS
    } catch (e) {
      return defs.ERRNO_IO
    }
  }

  path_open(
    dirfd: number,
    _dirflags: number,
    path: number,
    pathLen: number,
    _oflags: number,
    _fsRightsBase: number,
    _fsRightsInheriting: number,
    _fdflags: number,
    fdPtr: number,
  ): number {
    const fileDesc = this.fds.get(dirfd)
    if (!fileDesc) return defs.ERRNO_BADF

    const mem = new Uint8Array(this.wasm.memory.buffer)
    const pathBuffer = mem.slice(path, path + pathLen)
    const pathString = this.textDecoder.decode(pathBuffer)

    try {
      // Resolve path relative to the directory fd
      let resolvedPath = pathString
      if (fileDesc.preopenPath) {
        if (pathString.startsWith('/')) {
          resolvedPath = pathString.slice(1)
        }
        resolvedPath =
          fileDesc.preopenPath +
          (fileDesc.preopenPath.endsWith('/') ? '' : '/') +
          resolvedPath
      }

      // Verify file exists
      this.fs.statSync(resolvedPath)

      // Store path and initial position in handle
      const fd = this.allocateFd({ path: resolvedPath, position: 0 }, 'file')

      const view = new DataView(this.wasm.memory.buffer)
      view.setUint32(fdPtr, fd, true)
      return defs.ERRNO_SUCCESS
    } catch (e) {
      return defs.ERRNO_NOENT
    }
  }

  proc_exit(code: number): void {
    throw new WASIProcExit(code)
  }

  fd_fdstat_get(fd: number, statPtr: number): number {
    const fileDesc = this.fds.get(fd)
    if (!fileDesc) return defs.ERRNO_BADF

    const view = new DataView(this.wasm.memory.buffer)

    // filetype - u8
    let filetype
    switch (fileDesc.type) {
      case 'stdio':
        filetype = defs.FILETYPE_CHARACTER_DEVICE
        break
      case 'directory':
        filetype = defs.FILETYPE_DIRECTORY
        break
      case 'file':
        filetype = defs.FILETYPE_REGULAR_FILE
        break
      default:
        filetype = defs.FILETYPE_UNKNOWN
    }
    view.setUint8(statPtr, filetype)

    // fdflags - u16
    // For now, we'll assume basic flags
    let fdflags = 0
    if (fileDesc.append) fdflags |= defs.FDFLAGS_APPEND
    view.setUint16(statPtr + 2, fdflags, true)

    // fs_rights_base - u64
    // Set basic rights depending on file type
    let fsRightsBase: bigint | number = 0n
    if (fileDesc.type === 'file') {
      fsRightsBase =
        defs.RIGHTS_FD_READ |
        defs.RIGHTS_FD_WRITE |
        defs.RIGHTS_FD_SEEK |
        defs.RIGHTS_FD_TELL |
        defs.RIGHTS_FD_FILESTAT_GET
    } else if (fileDesc.type === 'directory') {
      fsRightsBase =
        defs.RIGHTS_PATH_OPEN |
        defs.RIGHTS_FD_READDIR |
        defs.RIGHTS_PATH_CREATE_DIRECTORY |
        defs.RIGHTS_PATH_UNLINK_FILE |
        defs.RIGHTS_PATH_REMOVE_DIRECTORY
    }
    const bf = BigInt(fsRightsBase)
    view.setBigUint64(statPtr + 8, bf, true)

    // fs_rights_inheriting - u64
    // Child files/directories inherit the same rights
    view.setBigUint64(statPtr + 16, bf, true)

    return defs.ERRNO_SUCCESS
  }

  fd_fdstat_set_flags(fd: number, flags: number): number {
    const fileDesc = this.fds.get(fd)
    if (!fileDesc) return defs.ERRNO_BADF

    // Check if flags are valid
    const validFlags =
      defs.FDFLAGS_APPEND |
      defs.FDFLAGS_DSYNC |
      defs.FDFLAGS_NONBLOCK |
      defs.FDFLAGS_RSYNC |
      defs.FDFLAGS_SYNC

    if (flags & ~validFlags) {
      return defs.ERRNO_INVAL // Invalid flags specified
    }

    // For stdio handles, we can't set flags
    if (fileDesc.type === 'stdio') {
      return defs.ERRNO_NOTSUP
    }

    try {
      // Update internal file descriptor state
      fileDesc.append = Boolean(flags & defs.FDFLAGS_APPEND)

      // Try to apply flags to the underlying file system
      // Note: Many flags might not be supported by the underlying fs
      if (fileDesc.handle && typeof this.fs.setFlagsSync === 'function') {
        this.fs.setFlagsSync(fileDesc.handle.path, flags)
      }

      return defs.ERRNO_SUCCESS
    } catch (e) {
      return defs.ERRNO_IO
    }
  }

  fd_prestat_get(fd: number, prestatPtr: number): number {
    const fileDesc = this.fds.get(fd)
    if (!fileDesc) return defs.ERRNO_BADF

    // Only directory file descriptors have prestats
    if (fileDesc.type !== 'directory') {
      return defs.ERRNO_BADF
    }

    // Ensure we have a preopened path for this fd
    if (!fileDesc.preopenPath) {
      return defs.ERRNO_BADF
    }

    const view = new DataView(this.wasm.memory.buffer)

    // Write prestat struct:
    // struct prestat {
    //   u8 type;    // offset 0
    //   u64 length; // offset 8 (with padding)
    // }

    // Set type to PREOPENTYPE_DIR (0)
    view.setUint8(prestatPtr, defs.PREOPENTYPE_DIR)

    // Get the length of the preopened directory path
    const pathLength = fileDesc.preopenPath.length
    view.setUint32(prestatPtr + 4, pathLength, true)

    return defs.ERRNO_SUCCESS
  }

  fd_prestat_dir_name(fd: number, pathPtr: number, pathLen: number): number {
    const fileDesc = this.fds.get(fd)
    if (!fileDesc) return defs.ERRNO_BADF

    // Only directory file descriptors have prestats
    if (fileDesc.type !== 'directory') {
      return defs.ERRNO_BADF
    }

    // Ensure we have a preopened path for this fd
    if (!fileDesc.preopenPath) {
      return defs.ERRNO_BADF
    }

    // Check if the provided buffer is large enough
    if (pathLen < fileDesc.preopenPath.length) {
      return defs.ERRNO_NAMETOOLONG
    }

    // Write the path to memory
    const mem = new Uint8Array(this.wasm.memory.buffer)
    const pathBytes = this.textEncoder.encode(fileDesc.preopenPath)
    mem.set(pathBytes, pathPtr)

    return defs.ERRNO_SUCCESS
  }

  path_filestat_get(
    fd: number,
    flags: number,
    pathPtr: number,
    pathLen: number,
    filestatPtr: number,
  ): number {
    const fileDesc = this.fds.get(fd)
    if (!fileDesc) return defs.ERRNO_BADF

    // Read the path from memory
    const mem = new Uint8Array(this.wasm.memory.buffer)
    const pathBytes = new Uint8Array(mem.buffer, pathPtr, pathLen)
    const pathString = this.textDecoder.decode(pathBytes)

    try {
      // Resolve path relative to the directory fd
      let resolvedPath = pathString
      if (fileDesc.preopenPath) {
        // If path starts with '/', make it relative to preopenPath
        if (pathString.startsWith('/')) {
          resolvedPath = pathString.slice(1) // Remove leading '/'
        }
        // Combine preopenPath with the relative path
        resolvedPath =
          fileDesc.preopenPath +
          (fileDesc.preopenPath.endsWith('/') ? '' : '/') +
          resolvedPath
      }

      // Get stats from filesystem
      const stats = this.fs.statSync(resolvedPath, {
        followSymlinks: (flags & defs.LOOKUPFLAGS_SYMLINK_FOLLOW) !== 0,
      })

      const view = new DataView(this.wasm.memory.buffer)

      // Write filestat struct:
      // struct filestat {
      //   dev: u64,        // Device ID
      //   ino: u64,        // Inode number
      //   filetype: u8,    // File type
      //   nlink: u64,      // Number of hard links
      //   size: u64,       // File size
      //   atim: u64,       // Access time
      //   mtim: u64,       // Modification time
      //   ctim: u64        // Change time
      // }

      // Device ID
      view.setBigUint64(filestatPtr, BigInt(stats.dev || 0), true)

      // Inode
      view.setBigUint64(filestatPtr + 8, BigInt(stats.ino || 0), true)

      // Filetype
      let filetype: number = defs.FILETYPE_UNKNOWN
      if (stats.isFile()) filetype = defs.FILETYPE_REGULAR_FILE
      else if (stats.isDirectory()) filetype = defs.FILETYPE_DIRECTORY
      else if (stats.isSymbolicLink()) filetype = defs.FILETYPE_SYMBOLIC_LINK
      else if (stats.isCharacterDevice())
        filetype = defs.FILETYPE_CHARACTER_DEVICE
      else if (stats.isBlockDevice()) filetype = defs.FILETYPE_BLOCK_DEVICE
      else if (stats.isFIFO()) filetype = defs.FILETYPE_SOCKET_STREAM
      view.setUint8(filestatPtr + 16, filetype)

      // Number of hard links
      view.setBigUint64(filestatPtr + 24, BigInt(stats.nlink || 1), true)

      // File size
      view.setBigUint64(filestatPtr + 32, BigInt(stats.size || 0), true)

      // Access time (in nanoseconds)
      view.setBigUint64(
        filestatPtr + 40,
        BigInt(stats.atimeMs * 1_000_000),
        true,
      )

      // Modification time (in nanoseconds)
      view.setBigUint64(
        filestatPtr + 48,
        BigInt(stats.mtimeMs * 1_000_000),
        true,
      )

      // Change time (in nanoseconds)
      view.setBigUint64(
        filestatPtr + 56,
        BigInt(stats.ctimeMs * 1_000_000),
        true,
      )

      return defs.ERRNO_SUCCESS
    } catch (error) {
      const e = error as Error & { code: string }
      if (e.code === 'ENOENT') return defs.ERRNO_NOENT
      if (e.code === 'EACCES') return defs.ERRNO_ACCES
      return defs.ERRNO_IO
    }
  }

  // File/Directory Operations
  fd_advise(
    fd: number,
    _offset: number,
    _len: number,
    _advice: number,
  ): number {
    const fileDesc = this.fds.get(fd)
    if (!fileDesc) return defs.ERRNO_BADF
    if (fileDesc.type !== 'file') return defs.ERRNO_BADF

    // Most filesystems don't actually implement advisory hints,
    // so we'll just return success
    return defs.ERRNO_SUCCESS
  }

  fd_allocate(fd: number, offset: number, len: number): number {
    const fileDesc = this.fds.get(fd)
    if (!fileDesc) return defs.ERRNO_BADF
    if (fileDesc.type !== 'file') return defs.ERRNO_BADF

    try {
      // Attempt to extend the file to the specified size
      const stats = this.fs.statSync(fileDesc.handle.path)
      const newSize = Number(offset) + Number(len)
      if (newSize > stats.size) {
        // Create a buffer of zeros to extend the file
        const zeros = new Uint8Array(newSize - stats.size)
        this.fs.appendFileSync(fileDesc.handle.path, zeros)
      }
      return defs.ERRNO_SUCCESS
    } catch (e) {
      return defs.ERRNO_IO
    }
  }

  fd_datasync(fd: number): number {
    const fileDesc = this.fds.get(fd)
    if (!fileDesc) return defs.ERRNO_BADF
    if (fileDesc.type !== 'file') return defs.ERRNO_BADF

    try {
      // Most JavaScript filesystem implementations handle syncing automatically
      // If your fs implementation has a specific sync method, call it here
      if (typeof this.fs.fsyncSync === 'function') {
        this.fs.fsyncSync(fileDesc.handle.path)
      }
      return defs.ERRNO_SUCCESS
    } catch (e) {
      return defs.ERRNO_IO
    }
  }

  fd_filestat_set_size(fd: number, size: number): number {
    const fileDesc = this.fds.get(fd)
    if (!fileDesc) return defs.ERRNO_BADF
    if (fileDesc.type !== 'file') return defs.ERRNO_BADF

    try {
      this.fs.truncateSync(fileDesc.handle.path, Number(size))
      return defs.ERRNO_SUCCESS
    } catch (e) {
      return defs.ERRNO_IO
    }
  }

  fd_filestat_set_times(
    fd: number,
    atim: number,
    mtim: number,
    _fst_flags: number,
  ): number {
    const fileDesc = this.fds.get(fd)
    if (!fileDesc) return defs.ERRNO_BADF
    if (fileDesc.type !== 'file') return defs.ERRNO_BADF

    try {
      const times = {
        atime: Number(atim) / 1_000_000_000,
        mtime: Number(mtim) / 1_000_000_000,
      }

      this.fs.utimesSync(fileDesc.handle.path, times.atime, times.mtime)
      return defs.ERRNO_SUCCESS
    } catch (e) {
      return defs.ERRNO_IO
    }
  }

  fd_pread(
    fd: number,
    iovs: number,
    iovsLen: number,
    offset: number,
    nreadPtr: number,
  ): number {
    const fileDesc = this.fds.get(fd)
    if (!fileDesc) return defs.ERRNO_BADF
    if (fileDesc.type !== 'file') return defs.ERRNO_BADF

    try {
      const content = this.fs.readFileSync(fileDesc.handle.path)
      let totalRead = 0
      const view = new DataView(this.wasm.memory.buffer)
      const mem = new Uint8Array(this.wasm.memory.buffer)

      const position = Number(offset)

      for (let i = 0; i < iovsLen; i++) {
        const ptr = iovs + i * 8
        const buf = view.getUint32(ptr, true)
        const bufLen = view.getUint32(ptr + 4, true)

        const start = position + totalRead
        const end = Math.min(start + bufLen, content.length)
        const bytesToRead = end - start

        if (bytesToRead <= 0) break

        mem.set(new Uint8Array(content.slice(start, end)), buf)
        totalRead += bytesToRead

        if (bytesToRead < bufLen) break
      }

      view.setUint32(nreadPtr, totalRead, true)
      return defs.ERRNO_SUCCESS
    } catch (e) {
      return defs.ERRNO_IO
    }
  }

  fd_pwrite(
    fd: number,
    iovs: number,
    iovsLen: number,
    offset: number,
    nwrittenPtr: number,
  ): number {
    const fileDesc = this.fds.get(fd)
    if (!fileDesc) return defs.ERRNO_BADF
    if (fileDesc.type !== 'file') return defs.ERRNO_BADF

    try {
      let written = 0
      const chunks = []
      const view = new DataView(this.wasm.memory.buffer)
      const mem = new Uint8Array(this.wasm.memory.buffer)

      for (let i = 0; i < iovsLen; i++) {
        const ptr = iovs + i * 8
        const buf = view.getUint32(ptr, true)
        const bufLen = view.getUint32(ptr + 4, true)
        chunks.push(new Uint8Array(mem.buffer, buf, bufLen))
        written += bufLen
      }

      let buffer
      if (chunks.length === 1) {
        buffer = chunks[0]
      } else {
        buffer = new Uint8Array(written)
        let offset = 0
        for (const chunk of chunks) {
          buffer.set(chunk, offset)
          offset += chunk.length
        }
      }

      // Read existing file content
      const content = this.fs.readFileSync(fileDesc.handle.path)
      const newContent = new Uint8Array(
        Math.max(Number(offset) + buffer.length, content.length),
      )

      // Copy existing content
      newContent.set(content)
      // Write new data at specified offset
      newContent.set(buffer, Number(offset))

      // Write back to file
      this.fs.writeFileSync(fileDesc.handle.path, newContent)

      view.setUint32(nwrittenPtr, written, true)
      return defs.ERRNO_SUCCESS
    } catch (e) {
      return defs.ERRNO_IO
    }
  }

  fd_readdir(
    fd: number,
    buf: number,
    bufLen: number,
    cookie: number,
    bufusedPtr: number,
  ): number {
    const fileDesc = this.fds.get(fd)
    if (!fileDesc) return defs.ERRNO_BADF
    if (fileDesc.type !== 'directory') return defs.ERRNO_NOTDIR

    try {
      const entries = this.fs.readdirSync(fileDesc.handle.path, {
        withFileTypes: true,
      })
      const view = new DataView(this.wasm.memory.buffer)
      const mem = new Uint8Array(this.wasm.memory.buffer)

      let offset = 0
      let entriesWritten = 0

      // Skip entries according to cookie
      const startIndex = Number(cookie)

      for (let i = startIndex; i < entries.length; i++) {
        const entry = entries[i]
        const name = entry.name
        const nameBytes = this.textEncoder.encode(name)

        // dirent structure size: 24 bytes + name length
        const direntSize = 24 + nameBytes.length

        if (offset + direntSize > bufLen) {
          break
        }

        // Write dirent structure
        view.setBigUint64(buf + offset, BigInt(i + 1), true) // d_next
        view.setBigUint64(buf + offset + 8, 0n, true) // d_ino
        view.setUint32(buf + offset + 16, nameBytes.length, true) // d_namlen

        // d_type
        let filetype: number = defs.FILETYPE_UNKNOWN
        if (entry.isFile()) filetype = defs.FILETYPE_REGULAR_FILE
        else if (entry.isDirectory()) filetype = defs.FILETYPE_DIRECTORY
        view.setUint8(buf + offset + 20, filetype)

        // Write name
        mem.set(nameBytes, buf + offset + 24)

        offset += direntSize
        entriesWritten++
      }

      view.setUint32(bufusedPtr, offset, true)
      return defs.ERRNO_SUCCESS
    } catch (e) {
      return defs.ERRNO_IO
    }
  }

  fd_renumber(from: number, to: number): number {
    const fromDesc = this.fds.get(from)
    if (!fromDesc) return defs.ERRNO_BADF

    // Close existing 'to' fd if it exists
    this.fds.delete(to)

    // Move the fd
    this.fds.set(to, fromDesc)
    this.fds.delete(from)

    return defs.ERRNO_SUCCESS
  }

  fd_sync(fd: number): number {
    const fileDesc = this.fds.get(fd)
    if (!fileDesc) return defs.ERRNO_BADF
    if (fileDesc.type !== 'file') return defs.ERRNO_BADF

    try {
      // Similar to fd_datasync, but might include metadata
      if (typeof this.fs.fsyncSync === 'function') {
        this.fs.fsyncSync(fileDesc.handle.path)
      }
      return defs.ERRNO_SUCCESS
    } catch (e) {
      return defs.ERRNO_IO
    }
  }

  fd_tell(fd: number, offsetPtr: number): number {
    const fileDesc = this.fds.get(fd)
    if (!fileDesc) return defs.ERRNO_BADF
    if (fileDesc.type !== 'file') return defs.ERRNO_BADF

    const view = new DataView(this.wasm.memory.buffer)
    view.setBigUint64(offsetPtr, BigInt(fileDesc.handle.position), true)
    return defs.ERRNO_SUCCESS
  }

  // Path Operations
  path_create_directory(fd: number, path: number, pathLen: number): number {
    const fileDesc = this.fds.get(fd)
    if (!fileDesc) return defs.ERRNO_BADF

    const pathString = this.textDecoder.decode(
      new Uint8Array(this.wasm.memory.buffer, path, pathLen),
    )

    try {
      let resolvedPath = pathString
      if (fileDesc.preopenPath) {
        if (pathString.startsWith('/')) {
          resolvedPath = pathString.slice(1)
        }
        resolvedPath = fileDesc.preopenPath + '/' + resolvedPath
      }

      this.fs.mkdirSync(resolvedPath)
      return defs.ERRNO_SUCCESS
    } catch (e) {
      return defs.ERRNO_IO
    }
  }

  path_filestat_set_times(
    fd: number,
    _flags: number,
    path: number,
    pathLen: number,
    atim: number,
    mtim: number,
    _fst_flags: number,
  ): number {
    const fileDesc = this.fds.get(fd)
    if (!fileDesc) return defs.ERRNO_BADF

    const pathString = this.textDecoder.decode(
      new Uint8Array(this.wasm.memory.buffer, path, pathLen),
    )

    try {
      let resolvedPath = pathString
      if (fileDesc.preopenPath) {
        if (pathString.startsWith('/')) {
          resolvedPath = pathString.slice(1)
        }
        resolvedPath = fileDesc.preopenPath + '/' + resolvedPath
      }

      const times = {
        atime: Number(atim) / 1_000_000_000,
        mtime: Number(mtim) / 1_000_000_000,
      }

      this.fs.utimesSync(resolvedPath, times.atime, times.mtime)
      return defs.ERRNO_SUCCESS
    } catch (e) {
      return defs.ERRNO_IO
    }
  }

  path_link(
    old_fd: number,
    _old_flags: number,
    old_path: number,
    old_path_len: number,
    new_fd: number,
    new_path: number,
    new_path_len: number,
  ): number {
    const oldFileDesc = this.fds.get(old_fd)
    const newFileDesc = this.fds.get(new_fd)
    if (!oldFileDesc || !newFileDesc) return defs.ERRNO_BADF

    const oldPathString = this.textDecoder.decode(
      new Uint8Array(this.wasm.memory.buffer, old_path, old_path_len),
    )
    const newPathString = this.textDecoder.decode(
      new Uint8Array(this.wasm.memory.buffer, new_path, new_path_len),
    )

    try {
      let resolvedOldPath = oldPathString
      let resolvedNewPath = newPathString

      if (oldFileDesc.preopenPath) {
        if (oldPathString.startsWith('/')) {
          resolvedOldPath = oldPathString.slice(1)
        }
        resolvedOldPath = oldFileDesc.preopenPath + '/' + resolvedOldPath
      }

      if (newFileDesc.preopenPath) {
        if (newPathString.startsWith('/')) {
          resolvedNewPath = newPathString.slice(1)
        }
        resolvedNewPath = newFileDesc.preopenPath + '/' + resolvedNewPath
      }

      this.fs.linkSync(resolvedOldPath, resolvedNewPath)
      return defs.ERRNO_SUCCESS
    } catch (e) {
      return defs.ERRNO_IO
    }
  }

  path_readlink(
    fd: number,
    path: number,
    path_len: number,
    buf: number,
    buf_len: number,
    bufused: number,
  ): number {
    const fileDesc = this.fds.get(fd)
    if (!fileDesc) return defs.ERRNO_BADF

    const pathString = this.textDecoder.decode(
      new Uint8Array(this.wasm.memory.buffer, path, path_len),
    )

    try {
      let resolvedPath = pathString
      if (fileDesc.preopenPath) {
        if (pathString.startsWith('/')) {
          resolvedPath = pathString.slice(1)
        }
        resolvedPath = fileDesc.preopenPath + '/' + resolvedPath
      }

      const linkString = this.fs.readlinkSync(resolvedPath)
      const linkBytes = this.textEncoder.encode(linkString)

      if (linkBytes.length > buf_len) {
        return defs.ERRNO_OVERFLOW
      }

      const mem = new Uint8Array(this.wasm.memory.buffer)
      mem.set(linkBytes, buf)

      const view = new DataView(this.wasm.memory.buffer)
      view.setUint32(bufused, linkBytes.length, true)

      return defs.ERRNO_SUCCESS
    } catch (e) {
      return defs.ERRNO_IO
    }
  }

  path_remove_directory(fd: number, path: number, path_len: number): number {
    const fileDesc = this.fds.get(fd)
    if (!fileDesc) return defs.ERRNO_BADF

    const pathString = this.textDecoder.decode(
      new Uint8Array(this.wasm.memory.buffer, path, path_len),
    )

    try {
      let resolvedPath = pathString
      if (fileDesc.preopenPath) {
        if (pathString.startsWith('/')) {
          resolvedPath = pathString.slice(1)
        }
        resolvedPath = fileDesc.preopenPath + '/' + resolvedPath
      }

      this.fs.rmdirSync(resolvedPath)
      return defs.ERRNO_SUCCESS
    } catch (e) {
      return defs.ERRNO_IO
    }
  }

  path_rename(
    old_fd: number,
    old_path: number,
    old_path_len: number,
    new_fd: number,
    new_path: number,
    new_path_len: number,
  ): number {
    const oldFileDesc = this.fds.get(old_fd)
    const newFileDesc = this.fds.get(new_fd)
    if (!oldFileDesc || !newFileDesc) return defs.ERRNO_BADF

    const oldPathString = this.textDecoder.decode(
      new Uint8Array(this.wasm.memory.buffer, old_path, old_path_len),
    )
    const newPathString = this.textDecoder.decode(
      new Uint8Array(this.wasm.memory.buffer, new_path, new_path_len),
    )

    try {
      let resolvedOldPath = oldPathString
      let resolvedNewPath = newPathString

      if (oldFileDesc.preopenPath) {
        if (oldPathString.startsWith('/')) {
          resolvedOldPath = oldPathString.slice(1)
        }
        resolvedOldPath = oldFileDesc.preopenPath + '/' + resolvedOldPath
      }

      if (newFileDesc.preopenPath) {
        if (newPathString.startsWith('/')) {
          resolvedNewPath = newPathString.slice(1)
        }
        resolvedNewPath = newFileDesc.preopenPath + '/' + resolvedNewPath
      }

      this.fs.renameSync(resolvedOldPath, resolvedNewPath)
      return defs.ERRNO_SUCCESS
    } catch (e) {
      return defs.ERRNO_IO
    }
  }

  path_symlink(
    old_path: number,
    old_path_len: number,
    fd: number,
    new_path: number,
    new_path_len: number,
  ): number {
    const fileDesc = this.fds.get(fd)
    if (!fileDesc) return defs.ERRNO_BADF

    const oldPathString = this.textDecoder.decode(
      new Uint8Array(this.wasm.memory.buffer, old_path, old_path_len),
    )
    const newPathString = this.textDecoder.decode(
      new Uint8Array(this.wasm.memory.buffer, new_path, new_path_len),
    )

    try {
      let resolvedNewPath = newPathString
      if (fileDesc.preopenPath) {
        if (newPathString.startsWith('/')) {
          resolvedNewPath = newPathString.slice(1)
        }
        resolvedNewPath = fileDesc.preopenPath + '/' + resolvedNewPath
      }

      this.fs.symlinkSync(oldPathString, resolvedNewPath)
      return defs.ERRNO_SUCCESS
    } catch (e) {
      return defs.ERRNO_IO
    }
  }

  path_unlink_file(fd: number, path: number, path_len: number): number {
    const fileDesc = this.fds.get(fd)
    if (!fileDesc) return defs.ERRNO_BADF

    const pathString = this.textDecoder.decode(
      new Uint8Array(this.wasm.memory.buffer, path, path_len),
    )

    try {
      let resolvedPath = pathString
      if (fileDesc.preopenPath) {
        if (pathString.startsWith('/')) {
          resolvedPath = pathString.slice(1)
        }
        resolvedPath = fileDesc.preopenPath + '/' + resolvedPath
      }

      this.fs.unlinkSync(resolvedPath)
      return defs.ERRNO_SUCCESS
    } catch (e) {
      return defs.ERRNO_IO
    }
  }

  // Poll Operations
  poll_oneoff(
    in_: number,
    out: number,
    nsubscriptions: number,
    nevents: number,
  ): number {
    // Basic implementation that just processes all subscriptions immediately
    const view = new DataView(this.wasm.memory.buffer)
    let numEvents = 0

    for (let i = 0; i < nsubscriptions; i++) {
      const subPtr = in_ + i * 48 // size of subscription struct
      const userdata = view.getBigUint64(subPtr, true)
      const type = view.getUint8(subPtr + 8)

      // Write event
      const eventPtr = out + numEvents * 32 // size of event struct
      view.setBigUint64(eventPtr, userdata, true)
      view.setUint8(eventPtr + 8, type)
      view.setUint8(eventPtr + 9, defs.EVENTRWFLAGS_FD_READWRITE_HANGUP)
      view.setUint16(eventPtr + 10, 0, true) // error

      numEvents++
    }

    view.setUint32(nevents, numEvents, true)
    return defs.ERRNO_SUCCESS
  }

  // Random Number Generation
  random_get(buf: number, buf_len: number): number {
    const bytes = new Uint8Array(this.wasm.memory.buffer, buf, buf_len)
    crypto.getRandomValues(bytes)
    return defs.ERRNO_SUCCESS
  }

  // Scheduling Operations
  sched_yield(): number {
    // Can't really yield in JavaScript, just return success
    return defs.ERRNO_SUCCESS
  }

  // STUB
  sock_accept(_fd: number, _flags: number): number {
    return defs.ERRNO_NOSYS
  }

  sock_recv(_fd: number, _riData: number, _riFlags: number): number {
    return defs.ERRNO_NOSYS
  }

  sock_send(_fd: number, _siData: number, _riFlags: number): number {
    return defs.ERRNO_NOSYS
  }

  sock_shutdown(_fd: number, _how: number): number {
    return defs.ERRNO_NOSYS
  }
}
