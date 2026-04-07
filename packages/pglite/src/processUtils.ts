import { PostgresMod } from './postgresMod'

export abstract class Process {
  #fds = new Array<number>()
  #fork_fn: number = -1
  #kill_fn: number = -1
  #system_fn: number = -1
  #popen_fn: number = -1
  #pclose_fn: number = -1
  #getPid: number = -1

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

  protected addOsFunctions(os: OS) {
    this.#fork_fn = this.Module.addFunction(() => {
      // throw new Error('Fork not supported atm.')
      // todo: schedule starting a backend - need to get the parameters set in postmaster_child_launch
      return os.fork(this)
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

    this.#getPid = this.Module.addFunction(() => {
      return this.#pid
    }, 'i')

    this.Module._pgl_set_getpid_fn(this.#getPid)
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
    if (this.#getPid !== -1) {
      this.Module.removeFunction(this.#getPid)
      this.#getPid = -1
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
    return 0 // only in parent
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
}
