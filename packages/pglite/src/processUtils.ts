import { PostgresMod } from './postgresMod'

export abstract class Process {
  debug: number = 0
  #listeningSocketFd: number = -1
  #postmasterListenSocket: number = -1

  get isPostmaster(): boolean {
    return this.#postmasterListenSocket > -1
  }

  set postmasterListenSocket(value: number) {
    this.#postmasterListenSocket = value
  }

  set listeningSocketFd(value: number) {
    this.#listeningSocketFd = value
    this.#log('fd address in HEAPU8:', this.#listeningSocketFd)
  }

  get listeningSocketFd(): number {
    return this.#listeningSocketFd
  }

  triggerNewConnection() {
    const POLLIN = 0x0001
    if (this.#listeningSocketFd < 0)
      throw new Error(`Process ${this.#pid} has no listening socket`)

    // Set revents to POLLIN to indicate the socket is ready
    this.Module.HEAP16[(this.#listeningSocketFd + 6) >> 1] = POLLIN
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
  #fork_fn: number = -1
  #kill_fn: number = -1
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

  readonly #pid: number
  get pid() {
    return this.#pid
  }
  public constructor(pid: number) {
    this.#pid = pid
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

  abstract get Module(): PostgresMod

  abstract fork(): number

  protected addOsFunctions(os: OS) {
    this.#fork_fn = this.Module.addFunction(() => {
      // throw new Error('Fork not supported atm.')
      // todo: schedule starting a backend - need to get the parameters set in postmaster_child_launch
      // return os.fork(this)
      return this.fork()
    }, 'p')

    this.Module._pgl_set_fork_fn(this.#fork_fn)

    this.#kill_fn = this.Module.addFunction((pid: number, signal: number) => {
      return os.kill(this, pid, signal)
      // this.Module._PostmasterServerLoopOnce()
    }, 'iii')

    this.Module._pgl_set_kill_fn(this.#kill_fn)

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
      return this.#pid
    }, 'i')

    this.Module._pgl_set_getpid_fn(this.#getpid_fn)

    this.#poll_fn = this.Module.addFunction(
      (fds: number, nfds: number, timeout: number) => {
        this.#log('poll_fn', fds, nfds, timeout)
        return os.poll(this, fds, nfds, timeout)
      },
      'ipii',
    )

    this.Module._pgl_set_poll_fn(this.#poll_fn)

    this.#socket_fn = this.Module.addFunction(
      (domain: number, type: number, protocol: number) => {
        this.#log('socket_fn', domain, type, protocol)
        return os.socket(this, domain, type, protocol)
      },
      'iiii',
    )

    this.Module._pgl_set_socket_fn(this.#socket_fn)

    this.#bind_fn = this.Module.addFunction(
      (socket: number, address: number, address_len: number) => {
        this.#log('bind_fn', socket, address, address_len)
        return os.bind(this, socket, address, address_len)
      },
      'iipi',
    )

    this.Module._pgl_set_bind_fn(this.#bind_fn)

    this.#listen_fn = this.Module.addFunction(
      (socket: number, backlog: number) => {
        this.#log('listen_fn', socket, backlog)
        return os.listen(this, socket, backlog)
      },
      'iii',
    )

    this.Module._pgl_set_listen_fn(this.#listen_fn)

    this.#accept_fn = this.Module.addFunction(
      (socket: number, address: number, address_len: number) => {
        this.#log('accept_fn', socket, address, address_len)
        return os.accept(this, socket, address, address_len)
      },
      'iiii',
    )

    this.Module._pgl_set_accept_fn(this.#accept_fn)

    this.#close_fn = this.Module.addFunction((fd: number) => {
      this.#log('close_fn', fd)
      return os.close(this, fd)
    }, 'ii')

    this.Module._pgl_set_close_fn(this.#close_fn)
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
  debug: number
  nextPid: number = 2
  nextSocketFd: number = 1
  postmasterListenSocket: number = -1
  // postmasterProcess: Process | null = null
  /**
   * Internal log function
   */
  #log(...args: any[]) {
    if (this.debug > 0) {
      console.log('OS:', ...args)
    }
  }

  // #processTable = new ProcessTable()

  #handleExternalCmd(proc: Process, cmd: string, mode: string): number {
    if (cmd.startsWith('locale -a') && mode === 'r') {
      const filePath = proc.Module.stringToUTF8OnStack('/pglite/locale-a')
      const smode = proc.Module.stringToUTF8OnStack(mode)
      return proc.Module._fopen(filePath, smode)
    }
    throw new Error('Unhandled cmd')
  }

  constructor(debug?: number) {
    this.debug = debug ?? 0
  }

  fork(proc: Process): number {
    this.#log(`Fork called`, proc.pid)
    // TODO create new process
    return this.nextPid++ // todo: create process, return its pid
    // TODO
  }

  kill(proc: Process, pid: number, signal: number): number {
    this.#log(`Kill called`, proc.pid, pid, signal)
    return 0 //TODO
  }

  system(proc: Process, command: string): number {
    this.#log(
      `Process with pid ${proc.pid} tried to execute ${command}, returning 1.`,
    )
    return 1
  }

  popen(proc: Process, command: string, type: string): number {
    const externalCommandStreamFd = this.#handleExternalCmd(proc, command, type)
    proc.addFd(externalCommandStreamFd)
    return externalCommandStreamFd
  }

  pclose(proc: Process, stream: number): number {
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
    process: Process,
    _domain: number,
    _type: number,
    _protocol: number,
  ): number {
    const path = process.Module.stringToUTF8OnStack(
      `/tmp/socket_${this.nextSocketFd++}`,
    )
    const wplusmode = process.Module.stringToUTF8OnStack('w+')
    const socket_fd = process.Module._fopen(path, wplusmode)
    return socket_fd
  }

  bind(
    process: Process,
    socket: number,
    address: number,
    _address_len: number,
  ): number {
    const SA_DATA_OFFSET = 3
    const address_str = process.Module.UTF8ToString(address + SA_DATA_OFFSET)
    if (address_str === 'pglite_abstract_socket/.s.PGSQL.5432') {
      if (this.postmasterListenSocket !== -1) {
        throw new Error('Postmaster listen socket already bound')
      }
      process.postmasterListenSocket = socket
      this.postmasterListenSocket = socket
      return 0
    } else {
      throw new Error('Unhandled bind')
    }
  }

  listen(_process: Process, socket: number, _backlog: number): number {
    if (this.postmasterListenSocket !== socket) {
      throw new Error('Socket not bound to postmaster')
    }
    return 0
  }

  accept(
    process: Process,
    _socket: number,
    _address: number,
    _address_len: number,
  ): number {
    const path = process.Module.stringToUTF8OnStack(
      `/tmp/socket_${this.nextSocketFd++}`,
    )
    const wplusmode = process.Module.stringToUTF8OnStack('w+')
    const socket_fd = process.Module._fopen(path, wplusmode)
    return socket_fd
  }

  close(process: Process, fd: number): number {
    if (process.isPostmaster && fd === this.postmasterListenSocket) {
      this.#log('Closing postmaster listen socket')
      this.postmasterListenSocket = -1
      process.listeningSocketFd = -1
    }
    return -1
  }

  poll(process: Process, fds: number, nfds: number, _timeout: number) {
    const POLLFD_SIZE = 8 // sizeof(struct pollfd)

    for (let i = 0; i < nfds; i++) {
      const base = fds + i * POLLFD_SIZE
      const fd = process.Module.HEAP32[base >> 2]
      if (fd === this.postmasterListenSocket && process.isPostmaster) {
        if (process.listeningSocketFd > 0) {
          return nfds
        }

        this.#log('poll: postmaster listen socket found in fds array, index', i)
        process.listeningSocketFd = base
        process.Module._exit(101)

        // unreachable
        return 666
      }
    }

    return nfds
  }
}
