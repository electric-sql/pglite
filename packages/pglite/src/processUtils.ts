import { PostgresMod } from './postgresMod'

export interface ProcessInfo {
  parent: PostgresProcess
  pid: number
  childType: number
  // Postgres is built with EXEC_BACKEND: a child is a fresh instance whose
  // main() is called with `--forkchild=<childKind> <paramFile>`.
  // paramFile holds the BackendParameters written by the postmaster.
  childKind?: string
  paramFile?: string
}

/**
 * A System V shared memory segment.
 * Segments belong to the OS, not to a process: one created by the postmaster
 * is found by key from any other process (see OS.shmget).
 */
interface ShmSegment {
  shmid: number
  key: number
  size: number
  // Address of the segment. It is the same in every process that attaches:
  // Postgres stores absolute pointers inside its main segment.
  addr: number | undefined
  // The process whose allocator provided the memory at `addr`.
  // undefined when it comes from the shared region of the common memory.
  allocatedBy: PostgresProcess | undefined
  // pid -> number of attachments held by that process
  attached: Map<number, number>
  creatorPid: number
  // IPC_RMID was called: destroy once nobody is attached
  removed: boolean
}

/**
 * A MAP_SHARED mapping of a file: every process mapping the file sees the
 * same memory (Postgres' dynamic shared memory segments).
 */
interface SharedMapping {
  node: any // the file (FS node)
  addr: number
  length: number
  // pid -> number of mappings held by that process
  attached: Map<number, number>
}

export abstract class PostgresProcess {
  static readonly PostmasterChildType: number = -1

  debug: number = 0
  #listeningSocketFd: number = -1
  #postmasterListenSocket: number = -1

  exitedChildren: Array<{ pid: number; exitStatus: number }> = []

  set postmasterListenSocket(value: number) {
    this.#postmasterListenSocket = value
  }

  get postmasterListenSocket(): number {
    return this.#postmasterListenSocket
  }

  set listeningSocketFd(value: number) {
    this.#listeningSocketFd = value
    this.#log('fd address in HEAPU8:', this.#listeningSocketFd)
  }

  get listeningSocketFd(): number {
    return this.#listeningSocketFd
  }

  /**
   * Where this process lives in the common memory (see OS), or undefined
   * when it has a memory of its own (single mode).
   */
  memoryBase: number | undefined = undefined

  triggerNewConnection() {
    const result = this.Module._hlp_trigger_new_connection()
    if (result !== 1) {
      throw new Error(`Could not trigger a new connection. ${result}`)
    }
    // const POLLIN = 0x0001
    // if (this.#listeningSocketFd < 0)
    //   throw new Error(`Process ${this.#pid} has no listening socket`)

    // // Set revents to POLLIN to indicate the socket is ready
    // this.Module.HEAP16[(this.#listeningSocketFd + 6) >> 1] = POLLIN
  }
  /**
   * Internal log function
   */
  #log(...args: any[]) {
    if (this.debug > 0) {
      console.log('Process:', ...args)
    }
  }

  #fds = new Array<number>()
  #signalHandlers = new Map<number, number>()
  #fork_fn: number = -1
  #kill_fn: number = -1
  #sigaction_fn: number = -1
  #system_fn: number = -1
  #popen_fn: number = -1
  #pclose_fn: number = -1
  #getpid_fn: number = -1
  #poll_fn: number = -1
  #socket_fn: number = -1
  #bind_fn: number = -1
  #listen_fn: number = -1
  #accept_fn: number = -1
  #close_fn: number = -1
  #waitpid_fn: number = -1
  #shmget_fn: number = -1
  #shmat_fn: number = -1
  #shmdt_fn: number = -1
  #shmctl_fn: number = -1
  #mmap_fn: number = -1
  #munmap_fn: number = -1

  readonly pid: number
  readonly childType: number // -1 Postmaster, the rest are defined in postgres-pglite/src/include/miscadmin.h

  constructor(pid: number, childType: number) {
    this.pid = pid
    this.childType = childType
  }

  addFd(fd: number) {
    this.#fds.push(fd)
  }

  removeFd(fd: number) {
    this.#fds = this.#fds.filter((f) => f !== fd)
  }

  getFds() {
    return this.#fds
  }

  setSignalHandler(signum: number, handler: number): number {
    const prev = this.#signalHandlers.get(signum) ?? 0
    this.#signalHandlers.set(signum, handler)
    return prev
  }

  deliverSignal(signum: number): void {
    const SIG_DFL = 0
    const SIG_IGN = 1
    const handler = this.#signalHandlers.get(signum) ?? SIG_DFL
    if (handler === SIG_IGN || handler === SIG_DFL) return
    const table = (this.Module as any).wasmTable as WebAssembly.Table
    table.get(handler)(signum)
  }

  abstract get Module(): PostgresMod

  protected abstract pglite_fork(
    childType: number,
    childKind: string,
    paramFile: string,
  ): number

  protected addOsFunctions(os: OS) {
    this.#fork_fn = this.Module.addFunction(
      (child_type: number, child_kind: number, param_file: number) => {
        return this.pglite_fork(
          child_type,
          this.Module.UTF8ToString(child_kind),
          this.Module.UTF8ToString(param_file),
        )
      },
      'iipp',
    )

    this.Module._pgl_set_fork_fn(this.#fork_fn)

    this.#kill_fn = this.Module.addFunction((pid: number, signal: number) => {
      return os.kill(this, pid, signal)
      // this.Module._PostmasterServerLoopOnce()
    }, 'iii')

    this.Module._pgl_set_kill_fn(this.#kill_fn)

    this.#waitpid_fn = this.Module.addFunction(
      (pid: number, statusPtr: number, options: number) => {
        return os.waitpid(this, pid, statusPtr, options)
      },
      'iiii',
    )

    this.Module._pgl_set_waitpid_fn(this.#waitpid_fn)

    this.#sigaction_fn = this.Module.addFunction(
      (signum: number, handler: number) => {
        return os.sigaction(this, signum, handler)
      },
      'iii',
    )

    this.Module._pgl_set_sigaction_fn(this.#sigaction_fn)

    // we override system() to intercept any calls that might generate unexpected output
    this.#system_fn = this.Module.addFunction((cmd_ptr: number) => {
      const s = this.Module.UTF8ToString(cmd_ptr)
      return os.system(this, s)
    }, 'pi')

    this.Module._pgl_set_system_fn(this.#system_fn)

    this.#popen_fn = this.Module.addFunction(
      (cmd_ptr: number, mode: number) => {
        const args = this.Module.UTF8ToString(cmd_ptr)
        const smode = this.Module.UTF8ToString(mode)
        return os.popen(this, args, smode)
      },
      'ppp',
    )

    this.Module._pgl_set_popen_fn(this.#popen_fn)

    this.#pclose_fn = this.Module.addFunction((stream: number) => {
      return os.pclose(this, stream)
    }, 'pi')

    this.Module._pgl_set_pclose_fn(this.#pclose_fn)

    this.#getpid_fn = this.Module.addFunction(() => {
      return this.pid
    }, 'i')

    this.Module._pgl_set_getpid_fn(this.#getpid_fn)

    // this.#poll_fn = this.Module.addFunction(
    //   (fds: number, nfds: number, timeout: number) => {
    //     this.#log('poll_fn', fds, nfds, timeout)
    //     return os.poll(this, fds, nfds, timeout)
    //   },
    //   'ipii',
    // )

    // this.Module._pgl_set_poll_fn(this.#poll_fn)

    // this.#socket_fn = this.Module.addFunction(
    //   (domain: number, type: number, protocol: number) => {
    //     this.#log('socket_fn', domain, type, protocol)
    //     return os.socket(this, domain, type, protocol)
    //   },
    //   'iiii',
    // )

    // this.Module._pgl_set_socket_fn(this.#socket_fn)

    // this.#bind_fn = this.Module.addFunction(
    //   (socket: number, address: number, address_len: number) => {
    //     this.#log('bind_fn', socket, address, address_len)
    //     return os.bind(this, socket, address, address_len)
    //   },
    //   'iipi',
    // )

    // this.Module._pgl_set_bind_fn(this.#bind_fn)

    // this.#listen_fn = this.Module.addFunction(
    //   (socket: number, backlog: number) => {
    //     this.#log('listen_fn', socket, backlog)
    //     return os.listen(this, socket, backlog)
    //   },
    //   'iii',
    // )

    // this.Module._pgl_set_listen_fn(this.#listen_fn)

    // this.#accept_fn = this.Module.addFunction(
    //   (socket: number, address: number, address_len: number) => {
    //     this.#log('accept_fn', socket, address, address_len)
    //     return os.accept(this, socket, address, address_len)
    //   },
    //   'iiii',
    // )

    // this.Module._pgl_set_accept_fn(this.#accept_fn)

    this.#close_fn = this.Module.addFunction((fd: number) => {
      this.#log('close_fn', this.pid, this.childType, fd)
      return os.close(this, fd)
    }, 'ii')

    this.Module._pgl_set_close_fn(this.#close_fn)

    // System V shared memory: the segment table is kept by the OS
    this.#shmget_fn = this.Module.addFunction(
      (key: number, size: number, shmflg: number) => {
        return os.shmget(this, key, size, shmflg)
      },
      'iipi',
    )

    this.Module._pgl_set_shmget_fn(this.#shmget_fn)

    this.#shmat_fn = this.Module.addFunction(
      (shmid: number, shmaddr: number, shmflg: number) => {
        return os.shmat(this, shmid, shmaddr, shmflg)
      },
      'iipi',
    )

    this.Module._pgl_set_shmat_fn(this.#shmat_fn)

    this.#shmdt_fn = this.Module.addFunction((shmaddr: number) => {
      return os.shmdt(this, shmaddr)
    }, 'ip')

    this.Module._pgl_set_shmdt_fn(this.#shmdt_fn)

    this.#shmctl_fn = this.Module.addFunction(
      (shmid: number, cmd: number, statPtr: number) => {
        return os.shmctl(this, shmid, cmd, statPtr)
      },
      'iiip',
    )

    this.Module._pgl_set_shmctl_fn(this.#shmctl_fn)

    // shared file mappings: the table is kept by the OS
    this.#mmap_fn = this.Module.addFunction(
      (length: number, fd: number, offset: number) => {
        return os.mmap(this, length, fd, offset)
      },
      'ipii',
    )

    this.Module._pgl_set_mmap_fn(this.#mmap_fn)

    this.#munmap_fn = this.Module.addFunction(
      (addr: number, _length: number) => {
        return os.munmap(this, addr)
      },
      'ipp',
    )

    this.Module._pgl_set_munmap_fn(this.#munmap_fn)

    // this.#pipe_fn = this.Module.addFunction((pointer: number) => {
    //   this.#log('pipe_fn', pointer)
    //   return os.pipe(this, pointer)
    // }, 'ip')

    // this.Module._pgl_set_pipe_fn(this.#pipe_fn)
  }

  protected removeOsFunctions() {
    if (this.#fork_fn !== -1) {
      this.Module.removeFunction(this.#fork_fn)
      this.#fork_fn = -1
    }
    if (this.#kill_fn !== -1) {
      this.Module.removeFunction(this.#kill_fn)
      this.#kill_fn = -1
    }
    if (this.#waitpid_fn !== -1) {
      this.Module.removeFunction(this.#waitpid_fn)
      this.#waitpid_fn = -1
    }
    if (this.#sigaction_fn !== -1) {
      this.Module.removeFunction(this.#sigaction_fn)
      this.#sigaction_fn = -1
    }
    if (this.#system_fn !== -1) {
      this.Module.removeFunction(this.#system_fn)
      this.#system_fn = -1
    }
    if (this.#popen_fn !== -1) {
      this.Module.removeFunction(this.#popen_fn)
      this.#popen_fn = -1
    }
    if (this.#pclose_fn !== -1) {
      this.Module.removeFunction(this.#pclose_fn)
      this.#pclose_fn = -1
    }
    if (this.#getpid_fn !== -1) {
      this.Module.removeFunction(this.#getpid_fn)
      this.#getpid_fn = -1
    }
    if (this.#poll_fn !== -1) {
      this.Module.removeFunction(this.#poll_fn)
      this.#poll_fn = -1
    }
    if (this.#socket_fn !== -1) {
      this.Module.removeFunction(this.#socket_fn)
      this.#socket_fn = -1
    }
    if (this.#bind_fn !== -1) {
      this.Module.removeFunction(this.#bind_fn)
      this.#bind_fn = -1
    }
    if (this.#listen_fn !== -1) {
      this.Module.removeFunction(this.#listen_fn)
      this.#listen_fn = -1
    }
    if (this.#accept_fn !== -1) {
      this.Module.removeFunction(this.#accept_fn)
      this.#accept_fn = -1
    }
    if (this.#close_fn !== -1) {
      this.Module.removeFunction(this.#close_fn)
      this.#close_fn = -1
    }
    if (this.#shmget_fn !== -1) {
      this.Module.removeFunction(this.#shmget_fn)
      this.#shmget_fn = -1
    }
    if (this.#shmat_fn !== -1) {
      this.Module.removeFunction(this.#shmat_fn)
      this.#shmat_fn = -1
    }
    if (this.#shmdt_fn !== -1) {
      this.Module.removeFunction(this.#shmdt_fn)
      this.#shmdt_fn = -1
    }
    if (this.#shmctl_fn !== -1) {
      this.Module.removeFunction(this.#shmctl_fn)
      this.#shmctl_fn = -1
    }
    if (this.#mmap_fn !== -1) {
      this.Module.removeFunction(this.#mmap_fn)
      this.#mmap_fn = -1
    }
    if (this.#munmap_fn !== -1) {
      this.Module.removeFunction(this.#munmap_fn)
      this.#munmap_fn = -1
    }
  }
}

// export class ProcessTable {
//     // #nextPid: number = 100

//     readonly #processes = new Array<Process>()

//     getProcess(pid: number): Process | undefined {
//         return this.#processes.find(process => process.pid === pid)
//     }

//     // public newProcess(pg: Process): Process {
//     //     const newProcess = new Process(this.#nextPid++, pg.Module.HEAPU8)
//     //     this.#processes.push(newProcess)
//     //     return newProcess
//     // }
// }

export class OS {
  /*
   * Layout of the common memory
   *
   * All Postgres processes of a multi-process PGlite live in one
   * WebAssembly.Memory, so that shared memory is simply memory:
   *
   *   0 .. SHARED_BASE                   unused (null pointers land here)
   *   SHARED_BASE .. PROCESS_BASE        shared region: System V segments
   *                                      and shared file mappings
   *   PROCESS_BASE + n * PROCESS_SIZE    process n: static data, stack, heap
   *
   * A process cannot grow its heap out of its own part (see pglitec_heap.c).
   */
  static readonly PAGE_SIZE = 65536
  static readonly MEMORY_SIZE = 2048 * 1024 * 1024
  static readonly SHARED_BASE = OS.PAGE_SIZE
  static readonly PROCESS_BASE = 256 * 1024 * 1024
  static readonly PROCESS_SIZE = 128 * 1024 * 1024
  static readonly MAX_PROCESSES = Math.floor(
    (OS.MEMORY_SIZE - OS.PROCESS_BASE) / OS.PROCESS_SIZE,
  )
  // allocations in the shared region are multiples of this
  static readonly SHARED_ALIGN = 4096

  #wasmMemory: WebAssembly.Memory | null = null

  get wasmMemory(): WebAssembly.Memory {
    if (!this.#wasmMemory) {
      // The memory never grows: growing would detach the views every
      // process has on it.
      const pages = OS.MEMORY_SIZE / OS.PAGE_SIZE
      this.#wasmMemory = new WebAssembly.Memory({
        initial: pages,
        maximum: pages,
      })
    }
    return this.#wasmMemory
  }

  // ---------- process parts of the common memory ----------

  // which pid sits in which part
  #processSlots = new Array<number | undefined>(OS.MAX_PROCESSES)
  // parts that were used before: they have to be zeroed before reuse, a new
  // process expects fresh memory to be zero
  #dirtySlots = new Set<number>()

  /**
   * Reserve a part of the common memory for a process.
   * @returns the base address of the part
   */
  allocProcessMemory(pid: number): number {
    const slot = this.#processSlots.findIndex((p) => p === undefined)
    if (slot === -1) {
      throw new Error(
        `Out of memory: cannot have more than ${OS.MAX_PROCESSES} processes`,
      )
    }
    this.#processSlots[slot] = pid
    const base = OS.PROCESS_BASE + slot * OS.PROCESS_SIZE
    if (this.#dirtySlots.has(slot)) {
      new Uint8Array(this.wasmMemory.buffer, base, OS.PROCESS_SIZE).fill(0)
    }
    this.#dirtySlots.add(slot)
    this.#log(`mem: process ${pid} lives at 0x${base.toString(16)}`)
    return base
  }

  freeProcessMemory(pid: number) {
    const slot = this.#processSlots.indexOf(pid)
    if (slot !== -1) {
      this.#processSlots[slot] = undefined
    }
  }

  // ---------- shared region of the common memory ----------

  // free extents, sorted by address
  #sharedFree: Array<{ addr: number; size: number }> = [
    { addr: OS.SHARED_BASE, size: OS.PROCESS_BASE - OS.SHARED_BASE },
  ]

  /**
   * Allocate zeroed memory in the shared region.
   * @returns the address, or 0 if there is not enough room
   */
  #sharedAlloc(size: number): number {
    const need = Math.ceil(size / OS.SHARED_ALIGN) * OS.SHARED_ALIGN
    const extent = this.#sharedFree.find((e) => e.size >= need)
    if (!extent) return 0
    const addr = extent.addr
    extent.addr += need
    extent.size -= need
    if (extent.size === 0) {
      this.#sharedFree.splice(this.#sharedFree.indexOf(extent), 1)
    }
    new Uint8Array(this.wasmMemory.buffer, addr, need).fill(0)
    return addr
  }

  #sharedRelease(addr: number, size: number) {
    const len = Math.ceil(size / OS.SHARED_ALIGN) * OS.SHARED_ALIGN
    let i = this.#sharedFree.findIndex((e) => e.addr > addr)
    if (i === -1) i = this.#sharedFree.length
    this.#sharedFree.splice(i, 0, { addr, size: len })
    // merge with the neighbours
    for (let k = Math.min(i + 1, this.#sharedFree.length - 1); k >= 1; k--) {
      const prev = this.#sharedFree[k - 1]
      const cur = this.#sharedFree[k]
      if (prev.addr + prev.size === cur.addr) {
        prev.size += cur.size
        this.#sharedFree.splice(k, 1)
      }
    }
  }

  debug: number
  // static readonly postmasterPid = 1
  nextPid: number = 1
  nextSocketFd: number = 1
  postmasterListenSocket: number = -1

  #pid2Process = new Map<number, PostgresProcess>()

  /**
   * Internal log function
   */
  #log(...args: any[]) {
    if (this.debug > 0) {
      console.log('OS:', ...args)
    }
  }

  registerProcess(proc: PostgresProcess) {
    this.#pid2Process.set(proc.pid, proc)
  }

  unregisterProcess(proc: PostgresProcess) {
    this.#pid2Process.delete(proc.pid)
    // like a kernel, drop whatever the process still had attached
    this.#shmDetachAll(proc.pid)
    this.#munmapAll(proc.pid)
    this.freeProcessMemory(proc.pid)
  }

  // ---------- System V shared memory ----------

  // keep in sync with PGL_SHM_E* in pglitec.c
  static readonly SHM_ENOENT = -1
  static readonly SHM_EEXIST = -2
  static readonly SHM_EINVAL = -3
  static readonly SHM_ENOMEM = -4

  // values from <sys/ipc.h>
  static readonly IPC_PRIVATE = 0
  static readonly IPC_CREAT = 0o1000
  static readonly IPC_EXCL = 0o2000
  static readonly IPC_RMID = 0
  static readonly IPC_SET = 1
  static readonly IPC_STAT = 2

  #shmSegments = new Map<number, ShmSegment>() // by shmid
  #nextShmid: number = 1

  #shmFindByKey(key: number): ShmSegment | undefined {
    if (key === OS.IPC_PRIVATE) return undefined
    for (const seg of this.#shmSegments.values()) {
      // a removed segment can no longer be found by key
      if (seg.key === key && !seg.removed) return seg
    }
    return undefined
  }

  #shmNattch(seg: ShmSegment): number {
    let nattch = 0
    for (const count of seg.attached.values()) nattch += count
    return nattch
  }

  /**
   * Provide the memory of a segment. Called on the first attach.
   * This is the single place deciding where a segment lives: in the shared
   * region of the common memory, where every process sees it at the same
   * address. A process with a memory of its own (single mode) has nobody to
   * share with and gets it from its own allocator.
   */
  #shmAllocate(proc: PostgresProcess, seg: ShmSegment): boolean {
    if (proc.memoryBase !== undefined) {
      const addr = this.#sharedAlloc(seg.size)
      if (!addr) return false
      seg.addr = addr
      seg.allocatedBy = undefined
      return true
    }
    const addr = proc.Module._malloc(seg.size)
    if (!addr) return false
    // new segments are zero-filled
    proc.Module.HEAPU8.fill(0, addr, addr + seg.size)
    seg.addr = addr
    seg.allocatedBy = proc
    return true
  }

  #shmDestroy(seg: ShmSegment) {
    this.#log(`shm: destroying segment ${seg.shmid} (key ${seg.key})`)
    if (seg.addr !== undefined) {
      if (!seg.allocatedBy) {
        this.#sharedRelease(seg.addr, seg.size)
      } else if (
        // only give the memory back if the owner of the allocator is alive
        this.#pid2Process.get(seg.allocatedBy.pid) === seg.allocatedBy
      ) {
        seg.allocatedBy.Module._free(seg.addr)
      }
    }
    this.#shmSegments.delete(seg.shmid)
  }

  #shmDetach(seg: ShmSegment, pid: number) {
    const count = seg.attached.get(pid) ?? 0
    if (count <= 1) {
      seg.attached.delete(pid)
    } else {
      seg.attached.set(pid, count - 1)
    }
    if (seg.removed && seg.attached.size === 0) {
      this.#shmDestroy(seg)
    }
  }

  #shmDetachAll(pid: number) {
    for (const seg of Array.from(this.#shmSegments.values())) {
      if (seg.attached.has(pid)) {
        seg.attached.set(pid, 1)
        this.#shmDetach(seg, pid)
      }
    }
  }

  shmget(
    proc: PostgresProcess,
    key: number,
    size: number,
    shmflg: number,
  ): number {
    const existing = this.#shmFindByKey(key)
    if (existing) {
      if (shmflg & OS.IPC_CREAT && shmflg & OS.IPC_EXCL) {
        return OS.SHM_EEXIST
      }
      if (size > existing.size) {
        return OS.SHM_EINVAL
      }
      return existing.shmid
    }

    if (!(shmflg & OS.IPC_CREAT)) {
      return OS.SHM_ENOENT
    }
    if (size === 0) {
      return OS.SHM_EINVAL
    }

    const seg: ShmSegment = {
      shmid: this.#nextShmid++,
      key,
      size,
      addr: undefined,
      allocatedBy: undefined,
      attached: new Map(),
      creatorPid: proc.pid,
      removed: false,
    }
    this.#shmSegments.set(seg.shmid, seg)
    this.#log(
      `shm: process ${proc.pid} created segment ${seg.shmid} (key ${key}, size ${size})`,
    )
    return seg.shmid
  }

  /**
   * @returns the address of the segment, or a negative SHM_E* code
   */
  shmat(
    proc: PostgresProcess,
    shmid: number,
    shmaddr: number,
    _shmflg: number,
  ): number {
    const seg = this.#shmSegments.get(shmid)
    if (!seg) {
      return OS.SHM_EINVAL
    }
    if (seg.addr === undefined) {
      if (!this.#shmAllocate(proc, seg)) {
        return OS.SHM_ENOMEM
      }
    }
    // A segment has one address for everybody. A caller asking for a specific
    // one (PGSharedMemoryReAttach asks for the postmaster's) can only get it.
    if (shmaddr !== 0 && shmaddr !== seg.addr) {
      return OS.SHM_EINVAL
    }
    seg.attached.set(proc.pid, (seg.attached.get(proc.pid) ?? 0) + 1)
    this.#log(
      `shm: process ${proc.pid} attached segment ${shmid} at ${seg.addr}`,
    )
    return seg.addr!
  }

  shmdt(proc: PostgresProcess, shmaddr: number): number {
    for (const seg of this.#shmSegments.values()) {
      if (seg.addr === shmaddr && seg.attached.has(proc.pid)) {
        this.#shmDetach(seg, proc.pid)
        return 0
      }
    }
    return OS.SHM_EINVAL
  }

  /**
   * @param statPtr PglShmStat in pglitec.c, filled for IPC_STAT
   */
  shmctl(
    proc: PostgresProcess,
    shmid: number,
    cmd: number,
    statPtr: number,
  ): number {
    const seg = this.#shmSegments.get(shmid)
    if (!seg) {
      return OS.SHM_EINVAL
    }
    switch (cmd) {
      case OS.IPC_RMID:
        seg.removed = true
        if (seg.attached.size === 0) {
          this.#shmDestroy(seg)
        }
        return 0
      case OS.IPC_STAT: {
        const view = new DataView(proc.Module.HEAPU8.buffer, statPtr, 16)
        view.setUint32(0, seg.size, true)
        view.setInt32(4, seg.key, true)
        view.setUint32(8, this.#shmNattch(seg), true)
        view.setInt32(12, seg.creatorPid, true)
        return 0
      }
      case OS.IPC_SET:
        return 0
      default:
        this.#log(`shm: unhandled shmctl cmd ${cmd}`)
        return OS.SHM_EINVAL
    }
  }

  reportChildExit(parentPid: number, childPid: number, exitCode: number) {
    const exitStatus = exitCode << 8
    this.#log(
      `reportChildExit parentPid=${parentPid} childPid=${childPid} exitCode=${exitCode} status=0x${exitStatus.toString(16)}`,
    )
    const parentProc = this.#pid2Process.get(parentPid)
    const childProc = this.#pid2Process.get(childPid)
    if (!parentProc || !childProc) {
      throw new Error(`No such process ${parentPid} or ${childProc}`)
    }
    parentProc.exitedChildren.push({ pid: childPid, exitStatus })
    const SIGCHLD = 17
    parentProc.deliverSignal(SIGCHLD)
    // options.processInfo!.parent.deliverSignal(SIGCHLD)
    PGliteOS.unregisterProcess(childProc)
  }

  waitpid(
    proc: PostgresProcess,
    pid: number,
    statusPtr: number,
    _options: number,
  ): number {
    let idx = -1
    if (pid === -1) {
      idx = proc.exitedChildren.length > 0 ? 0 : -1
    } else {
      idx = proc.exitedChildren.findIndex((e) => e.pid === pid)
    }

    if (idx === -1) {
      return 0
    }

    const entry = proc.exitedChildren.splice(idx, 1)[0]
    if (statusPtr !== 0) {
      proc.Module.HEAP32[statusPtr >> 2] = entry.exitStatus
    }
    this.#log(
      `waitpid returning pid=${entry.pid} status=0x${entry.exitStatus.toString(16)}`,
    )
    return entry.pid
  }

  // ---------- shared file mappings ----------

  #sharedMappings = new Array<SharedMapping>()

  /**
   * mmap(MAP_SHARED) of a file.
   * @returns the address of the mapping, 0 if not handled here (the caller
   * then makes a private copy), or a negative SHM_E* code
   */
  mmap(proc: PostgresProcess, length: number, fd: number, offset: number) {
    if (proc.memoryBase === undefined) {
      // a memory of its own: nobody to share with
      return 0
    }
    const FS = proc.Module.FS as any
    const stream = FS.getStream(fd)
    if (!stream || offset !== 0) {
      return OS.SHM_EINVAL
    }
    let mapping = this.#sharedMappings.find((m) => m.node === stream.node)
    if (mapping) {
      if (length > mapping.length) {
        return OS.SHM_EINVAL
      }
    } else {
      const addr = this.#sharedAlloc(length)
      if (!addr) {
        return OS.SHM_ENOMEM
      }
      // the mapping starts with the content of the file
      FS.read(stream, proc.Module.HEAPU8, addr, length, 0)
      mapping = { node: stream.node, addr, length, attached: new Map() }
      this.#sharedMappings.push(mapping)
    }
    mapping.attached.set(proc.pid, (mapping.attached.get(proc.pid) ?? 0) + 1)
    this.#log(
      `mmap: process ${proc.pid} mapped ${length} bytes at ${mapping.addr}`,
    )
    return mapping.addr
  }

  #unmap(mapping: SharedMapping, pid: number, all: boolean) {
    const count = mapping.attached.get(pid) ?? 0
    if (all || count <= 1) {
      mapping.attached.delete(pid)
    } else {
      mapping.attached.set(pid, count - 1)
    }
    if (mapping.attached.size === 0) {
      // Nobody maps the file anymore. The content is not written back to
      // the file: Postgres removes the file of a segment nobody uses.
      this.#sharedRelease(mapping.addr, mapping.length)
      this.#sharedMappings.splice(this.#sharedMappings.indexOf(mapping), 1)
    }
  }

  /**
   * @returns 0 if a mapping was released, -1 if addr is not a shared mapping
   * of this process
   */
  munmap(proc: PostgresProcess, addr: number): number {
    const mapping = this.#sharedMappings.find(
      (m) => m.addr === addr && m.attached.has(proc.pid),
    )
    if (!mapping) return -1
    this.#unmap(mapping, proc.pid, false)
    return 0
  }

  #munmapAll(pid: number) {
    for (const mapping of Array.from(this.#sharedMappings)) {
      if (mapping.attached.has(pid)) {
        this.#unmap(mapping, pid, true)
      }
    }
  }

  #handleExternalCmd(proc: PostgresProcess, cmd: string, mode: string): number {
    if (cmd.startsWith('locale -a') && mode === 'r') {
      const filePath = proc.Module.stringToUTF8OnStack('/pglite/locale-a')
      const smode = proc.Module.stringToUTF8OnStack(mode)
      return proc.Module._fopen(filePath, smode)
    }
    throw new Error(`Unhandled cmd ${cmd}`)
  }

  constructor(debug?: number) {
    this.debug = debug ?? 0
  }

  fork(proc: PostgresProcess): number {
    this.#log(`Fork called`, proc.pid)
    // TODO create new process
    return this.nextPid++ // todo: create process, return its pid
    // TODO
  }

  sigaction(proc: PostgresProcess, signum: number, handler: number): number {
    this.#log(`Sigaction called`, proc.pid, signum, handler)
    return proc.setSignalHandler(signum, handler)
  }

  kill(proc: PostgresProcess, pid: number, signal: number): number {
    this.#log(`Kill called`, proc.pid, pid, signal)
    const target = this.#pid2Process.get(pid)
    if (!target) {
      this.#log(`Kill: no process with pid ${pid}`)
      return -1
    }
    if (signal === 0) return 0
    target.deliverSignal(signal)
    return 0
  }

  system(proc: PostgresProcess, command: string): number {
    this.#log(
      `Process with pid ${proc.pid} tried to execute ${command}, returning 1.`,
    )
    return 1
  }

  popen(proc: PostgresProcess, command: string, type: string): number {
    const externalCommandStreamFd = this.#handleExternalCmd(proc, command, type)
    proc.addFd(externalCommandStreamFd)
    return externalCommandStreamFd
  }

  pclose(proc: PostgresProcess, stream: number): number {
    this.#log('pclose_fn', stream)
    if (proc.getFds().includes(stream)) {
      proc.Module._fclose(stream)
      proc.removeFd(stream)
      return 0
    } else {
      throw `Unhandled pclose ${stream}`
    }
  }

  socket(
    proc: PostgresProcess,
    _domain: number,
    _type: number,
    _protocol: number,
  ): number {
    const path = proc.Module.stringToUTF8OnStack(
      `/tmp/socket_${this.nextSocketFd++}`,
    )
    // const wplusmode = proc.Module.stringToUTF8OnStack('w+')
    const socket_fd = proc.Module._open(path, 0o2 | 0o100, 0o600)
    return socket_fd
  }

  bind(
    proc: PostgresProcess,
    socket: number,
    address: number,
    _address_len: number,
  ): number {
    const SA_DATA_OFFSET = 3
    const address_str = proc.Module.UTF8ToString(address + SA_DATA_OFFSET)
    if (address_str === 'pglite_abstract_socket/.s.PGSQL.5432') {
      if (this.postmasterListenSocket !== -1) {
        throw new Error('Postmaster listen socket already bound')
      }
      proc.postmasterListenSocket = socket
      this.postmasterListenSocket = socket
      return 0
    } else {
      throw new Error('Unhandled bind')
    }
  }

  listen(_proc: PostgresProcess, socket: number, _backlog: number): number {
    if (this.postmasterListenSocket !== socket) {
      throw new Error('Socket not bound to postmaster')
    }
    return 0
  }

  accept(
    proc: PostgresProcess,
    _socket: number,
    _address: number,
    _address_len: number,
  ): number {
    const path = proc.Module.stringToUTF8OnStack(
      `/tmp/socket_${this.nextSocketFd++}`,
    )
    // const wplusmode = proc.Module.stringToUTF8OnStack('w+')

    const socket_fd = proc.Module._open(path, 0o2 | 0o100, 0o600)
    return socket_fd
  }

  close(proc: PostgresProcess, fd: number): number {
    if (fd === this.postmasterListenSocket) {
      this.#log('Closing postmaster listen socket')
      this.postmasterListenSocket = -1
      proc.listeningSocketFd = -1
    }
    return -1
  }

  // poll(process: Process, fds: number, nfds: number, _timeout: number) {
  //   const POLLFD_SIZE = 8 // sizeof(struct pollfd)

  //   for (let i = 0; i < nfds; i++) {
  //     const base = fds + i * POLLFD_SIZE
  //     const fd = process.Module.HEAP32[base >> 2]
  //     if (fd === this.postmasterListenSocket) {
  //       if (process.listeningSocketFd > 0) {
  //         return nfds
  //       }

  //       this.#log('poll: postmaster listen socket found in fds array, index', i)
  //       process.listeningSocketFd = base
  //       process.Module._exit(101)

  //       // unreachable
  //       return 666
  //     }
  //   }

  //   return nfds
  // }

  // pipe(process: Process, pointer: number) {
  //   this.#log('pipe', process.pid, pointer)
  // }
}

export const PGliteOS = new OS()
