import type { PGlite } from '../pglite.js'
import type { PostgresMod } from '../postgresMod.js'
import { BaseFilesystem, FsStats, ERRNO_CODES } from './base.js'
import type { TarIndex, TarIndexFile } from './tarUtils.js'

type Node = TarIndexFile & {
  isDir: boolean
  children: Node[]
  data?: FilelikeInterface
  handle?: number
}

// These files are key to postgres starting up, it will page through the whole file
// so it's more efficient to load them all in full.
const fileToFullyLoad = new Set<string>([
  '/postgresql.conf',
  '/postgresql.auto.conf',
  '/PG_VERSION',
  '/postmaster.pid',
  '/global/pg_control',
])

// Whether to fetch files in full or by page
export type FetchGranularity = 'page' | 'file'

export interface HttpFsOptions {
  debug?: boolean
  fetchGranularity?: FetchGranularity
}

/**
 * A read-only filesystem that fetches files from a remote HTTP server.
 * Requires an index.json file at the root of the filesystem with a list of
 * files available to fetch
 */
export class HttpFs extends BaseFilesystem {
  index?: TarIndex
  tree?: Node
  httpPaths = new Set<string>()
  #handleMap: Map<number, Node> = new Map()
  #handleCounter = 0
  fetchGranularity: FetchGranularity

  constructor(
    baseUrl: string,
    { debug, fetchGranularity = 'page' }: HttpFsOptions,
  ) {
    super(baseUrl, { debug })
    this.fetchGranularity = fetchGranularity
  }

  async init(pg: PGlite, opts: Partial<PostgresMod>) {
    await this.#init()
    return super.init(pg, opts)
  }

  async closeFs(): Promise<void> {
    this.pg!.Module.FS.quit()
  }

  async #init() {
    const indexReq = await fetch(`${this.dataDir}/index.json`)
    const index = await indexReq.json()
    this.index = index
    for (const file of index.files) {
      this.httpPaths.add(file.name)
    }
    this.tree = buildTree(index)
  }

  getNode(path: string): Node | null {
    const parts = path.split('/').filter((part) => part !== '')
    let currentNode: Node | undefined = this.tree!
    for (const part of parts) {
      currentNode = currentNode.children.find((child) => child.name === part)
      if (!currentNode) {
        return null
      }
    }
    return currentNode
  }

  resolvePath(path: string): Node {
    const node = this.getNode(path)
    if (!node) {
      throw new FsError('ENOENT', 'No such file or directory')
    }
    return node
  }

  createNode(path: string, mode: number, type: number) {
    const node = this.getNode(path)
    if (node) {
      throw new Error('Node already exists')
    }
    const parts = path.split('/').filter((part) => part !== '')
    const lastPart = parts.pop()
    let currentNode: Node | undefined = this.tree!
    for (const part of parts) {
      currentNode = currentNode.children.find((child) => child.name === part)
      if (!currentNode) {
        // add the directory to the tree
        currentNode = {
          name: part,
          isDir: true,
          children: [],
          mode,
          size: 0,
          type,
          modifyTime: 0,
        }
        currentNode.children.push(currentNode)
      }
    }
    const newNode = {
      name: lastPart!,
      isDir: type === 5,
      children: [],
      mode,
      size: 0,
      type,
      modifyTime: Date.now(),
    }
    currentNode.children.push(newNode)
    return newNode
  }

  chmod(path: string, mode: number) {
    const node = this.getNode(path)
    if (!node) {
      throw new Error('Node does not exist')
    }
    node.mode = mode
  }

  close(_fd: number) {
    // No-op
  }

  #nodeStats(node: Node): FsStats {
    const blksize = 4096
    const size = node.data?.size() ?? node.size
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
      atime: node.modifyTime,
      mtime: node.modifyTime,
      ctime: node.modifyTime,
    }
  }

  fstat(fd: number) {
    const node = this.#handleMap.get(fd)
    if (!node) {
      throw new Error('File descriptor not found')
    }
    return this.#nodeStats(node)
  }

  lstat(path: string) {
    const node = this.resolvePath(path)
    return this.#nodeStats(node)
  }

  mkdir(path: string, _options?: { recursive?: boolean; mode?: number }) {
    const node = this.getNode(path)
    if (node) {
      throw new Error('Node already exists')
    }
    this.createNode(path, 16872, 1)
  }

  open(path: string, _flags?: string, mode?: number) {
    let node = this.getNode(path)
    if (!node) {
      node = this.createNode(path, mode!, 0)
    }
    if (!node.data && this.httpPaths.has(path)) {
      node.data = new HttpFilelike(
        `${this.dataDir}${path}`,
        node.size,
        this.fetchGranularity === 'file' || fileToFullyLoad.has(path),
      )
    } else if (!node.data) {
      node.data = new Filelike(new Uint8Array())
    }
    if (!node.handle) {
      node.handle = this.#handleCounter++
      this.#handleMap.set(node.handle, node)
    }
    return node.handle
  }

  readdir(path: string) {
    const node = this.getNode(path)
    if (!node) {
      throw new Error('Node does not exist')
    }
    if (!node.isDir) {
      throw new Error('Node is not a directory')
    }
    return node.children.map((child) => child.name)
  }

  read(
    fd: number,
    buffer: Int8Array, // Buffer to read into
    offset: number, // Offset in buffer to start writing to
    length: number, // Number of bytes to read
    position: number, // Position in file to read from
  ) {
    const node = this.#handleMap.get(fd)
    if (!node) {
      throw new Error('File descriptor not found')
    }
    return node.data?.read(buffer, offset, length, position) ?? 0
  }

  rename(oldPath: string, newPath: string) {
    const oldParts = oldPath.split('/').filter((part) => part !== '')
    const oldFilename = oldParts.pop()!
    const oldParent = this.getNode(oldParts.join('/'))
    if (!oldParent) {
      throw new Error('Parent directory does not exist')
    }
    const newParts = newPath.split('/').filter((part) => part !== '')
    const newFilename = newParts.pop()!
    const newParent = this.getNode(newParts.join('/'))
    if (!newParent) {
      throw new Error('Parent directory does not exist')
    }
    const oldNode = oldParent.children.find(
      (child) => child.name === oldFilename,
    )
    if (!oldNode) {
      throw new Error('File does not exist')
    }
    oldNode.name = newFilename
    oldParent.children = oldParent.children.filter(
      (child) => child.name !== oldFilename,
    )
    newParent.children.push(oldNode)
  }

  rmdir(path: string) {
    this.unlink(path)
  }

  truncate(
    path: string,
    len = 0, // Length to truncate to - defaults to 0
  ) {
    const node = this.getNode(path)
    if (!node) {
      throw new Error('Node does not exist')
    }
    if (node.data) {
      node.data.truncate(len)
    } else {
      node.size = len
    }
  }

  unlink(path: string) {
    const parts = path.split('/').filter((part) => part !== '')
    const lastPart = parts.pop()
    const parent = parts.join('/')
    const parentNode = this.getNode(parent)
    if (!parentNode) {
      throw new Error('Node does not exist')
    }
    parentNode.children = parentNode.children.filter(
      (child) => child.name !== lastPart,
    )
  }

  utimes(path: string, _atime: number, mtime: number) {
    const node = this.getNode(path)
    if (!node) {
      throw new Error('Node does not exist')
    }
    node.modifyTime = mtime
  }

  writeFile(
    path: string,
    data: string | Int8Array,
    options?: { encoding?: string; mode?: number; flag?: string },
  ) {
    let node = this.getNode(path)
    if (!node) {
      node = this.createNode(path, options?.mode ?? 33184, 0)
    }
    node.data = new Filelike(new Uint8Array(data as Int8Array))
  }

  write(
    fd: number,
    buffer: Int8Array, // Buffer to read from
    offset: number, // Offset in buffer to start reading from
    length: number, // Number of bytes to write
    position: number, // Position in file to write to
  ) {
    const node = this.#handleMap.get(fd)
    if (!node) {
      throw new Error('File descriptor not found')
    }
    return node.data?.write(buffer, offset, length, position) ?? 0
  }
}

function buildTree(index: TarIndex): Node {
  const root: Node = {
    name: '/',
    isDir: true,
    children: [],
    mode: 16872,
    size: 0,
    type: 5,
    modifyTime: 0,
  }
  for (const file of index.files) {
    const parts = file.name.split('/').filter((part) => part !== '')
    let currentNode = root

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      const isLastPart = i === parts.length - 1

      let childNode = currentNode.children.find((child) => child.name === part)

      if (!childNode) {
        childNode = {
          name: part,
          isDir: !isLastPart,
          children: [],
          mode: 16872,
          size: 0,
          type: 5,
          modifyTime: 0,
        }

        if (isLastPart) {
          childNode.size = file.size
          childNode.mode = file.mode
          childNode.modifyTime = file.modifyTime
          childNode.isDir = file.type === 5
          childNode.type = file.type
        }

        currentNode.children.push(childNode)
      }

      currentNode = childNode
    }
  }

  return root
}

interface FilelikeInterface {
  read(
    buffer: Int8Array,
    offset: number,
    length: number,
    position: number,
  ): number
  write(
    buffer: Int8Array,
    offset: number,
    length: number,
    position: number,
  ): number
  size(): number
  truncate(len: number): void
}

/**
 * A file like object for locally created files
 */
class Filelike implements FilelikeInterface {
  private data: Uint8Array

  constructor(data: Uint8Array) {
    this.data = data
  }

  read(
    buffer: Int8Array,
    offset: number,
    length: number,
    position: number,
  ): number {
    const bytesToRead = Math.min(length, this.data.length - position)
    buffer.set(this.data.slice(position, position + bytesToRead), offset)
    return bytesToRead
  }

  write(
    buffer: Int8Array,
    offset: number,
    length: number,
    position: number,
  ): number {
    if (position + length > this.data.length) {
      // Grow the file to the new size
      const newData = new Uint8Array(position + length)
      newData.set(this.data)
      this.data = newData
    }
    this.data.set(
      new Uint8Array(buffer.slice(offset, offset + length)),
      position,
    )
    return length
  }

  size(): number {
    return this.data.length
  }

  truncate(len: number): void {
    if (len < this.data.length) {
      this.data = this.data.slice(0, len)
    } else if (len > this.data.length) {
      const newData = new Uint8Array(len)
      newData.set(this.data)
      this.data = newData
    }
  }
}

/**
 * A file like object for files loaded from a remote HTTP server
 * If fullyLoad is true, the file is loaded into memory when the file is first read
 * Otherwise a range request is made to fetch the pages
 * Writes are stored in memory and overlay the original file when it is read
 */
class HttpFilelike implements FilelikeInterface {
  private data?: Uint8Array
  private writtenChunks: Record<number, Uint8Array> = {} // indexed by offset
  private url: string
  private length: number
  private fullyLoad: boolean

  constructor(url: string, length: number, fullyLoad: boolean) {
    this.url = url
    this.length = length
    this.fullyLoad = fullyLoad
  }

  load() {
    if (this.data) {
      return
    }
    this.data = syncFetch(this.url)
  }

  read(
    buffer: Int8Array,
    offset: number,
    length: number,
    position: number,
  ): number {
    if (this.fullyLoad) {
      this.load()
    }

    let bytesRead = 0

    // First, read from the base data or HTTP if not fully loaded
    if (!this.data) {
      if (position >= this.length) {
        return 0
      }
      const end = Math.min(this.length, position + length) - 1
      const range = { start: position, end }
      const data = syncFetch(this.url, range)
      buffer.set(data, offset)
      bytesRead = data.length
    } else {
      const bytesToRead = Math.min(length, this.length - position)
      buffer.set(this.data.slice(position, position + bytesToRead), offset)
      bytesRead = bytesToRead
    }

    // Overlay written chunks
    const chunkKeys = Object.keys(this.writtenChunks)
      .map(Number)
      .sort((a, b) => a - b)
    for (const chunkStart of chunkKeys) {
      const chunk = this.writtenChunks[chunkStart]
      const chunkEnd = chunkStart + chunk.length

      // Check if this chunk overlaps with the current read range
      if (position + length > chunkStart && position < chunkEnd) {
        const readStart = Math.max(position, chunkStart)
        const readEnd = Math.min(position + length, chunkEnd)
        const chunkOffset = readStart - chunkStart

        buffer.set(
          chunk.slice(chunkOffset, chunkOffset + (readEnd - readStart)),
          offset + (readStart - position),
        )
      }
    }

    return bytesRead
  }

  write(
    buffer: Int8Array,
    offset: number,
    length: number,
    position: number,
  ): number {
    // Overlay the new written data into `writtenChunks`
    let chunkStart = position
    let chunkEnd = position + length
    let chunkData = new Uint8Array(buffer.slice(offset, offset + length))

    // Check for existing overlaps with writtenChunks
    const chunkKeys = Object.keys(this.writtenChunks)
      .map(Number)
      .sort((a, b) => a - b)
    for (const key of chunkKeys) {
      const existingChunkStart = key
      const existingChunk = this.writtenChunks[existingChunkStart]
      const existingChunkEnd = existingChunkStart + existingChunk.length

      // If new chunk completely overlaps an existing chunk, remove the existing chunk
      if (chunkStart <= existingChunkStart && chunkEnd >= existingChunkEnd) {
        delete this.writtenChunks[existingChunkStart]
      } else if (
        chunkStart < existingChunkEnd &&
        chunkEnd > existingChunkStart
      ) {
        // If partial overlap, merge the chunks
        const newStart = Math.min(chunkStart, existingChunkStart)
        const newEnd = Math.max(chunkEnd, existingChunkEnd)

        const mergedChunk = new Uint8Array(newEnd - newStart)

        if (existingChunkStart < chunkStart) {
          mergedChunk.set(
            existingChunk.slice(0, chunkStart - existingChunkStart),
            0,
          )
        }

        mergedChunk.set(chunkData, chunkStart - newStart)

        if (existingChunkEnd > chunkEnd) {
          mergedChunk.set(
            existingChunk.slice(chunkEnd - existingChunkStart),
            chunkEnd - newStart,
          )
        }

        chunkStart = newStart
        chunkEnd = newEnd
        chunkData = mergedChunk
      }
    }

    this.writtenChunks[chunkStart] = chunkData

    // Update the length of the file
    this.length = Math.max(this.length, chunkEnd)

    return length
  }

  truncate(len: number): void {
    if (len === 0) {
      this.data = new Uint8Array()
      this.writtenChunks = {}
      this.length = 0
      return
    }

    this.load()

    if (len < this.data!.length) {
      this.data = this.data!.slice(0, len)
    } else if (len > this.data!.length) {
      const newData = new Uint8Array(len)
      newData.set(this.data!)
      this.data = newData
    }

    // Remove written chunks that exceed the new file length
    for (const chunkStart of Object.keys(this.writtenChunks).map(Number)) {
      if (chunkStart >= len) {
        delete this.writtenChunks[chunkStart]
      } else {
        const chunk = this.writtenChunks[chunkStart]
        if (chunkStart + chunk.length > len) {
          this.writtenChunks[chunkStart] = chunk.slice(0, len - chunkStart)
        }
      }
    }

    this.length = len
  }

  size(): number {
    return this.length
  }
}

class FsError extends Error {
  code?: number
  constructor(code: number | keyof typeof ERRNO_CODES | null, message: string) {
    super(message)
    if (typeof code === 'number') {
      this.code = code
    } else if (typeof code === 'string') {
      this.code = ERRNO_CODES[code]
    }
  }
}

function syncFetch(
  url: string,
  range?: { start: number; end: number },
): Uint8Array {
  const xhr = new XMLHttpRequest()
  xhr.open('GET', url, false)
  if (range) {
    xhr.setRequestHeader('Range', `bytes=${range.start}-${range.end}`)
  }
  xhr.responseType = 'arraybuffer'
  xhr.send(null)
  if (xhr.status !== 200 && xhr.status !== 206) {
    throw new Error('Failed to load file')
  }
  return new Uint8Array(xhr.response)
}
