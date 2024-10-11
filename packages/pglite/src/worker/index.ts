import type {
  DebugLevel,
  ExecProtocolResult,
  Extensions,
  PGliteInterface,
  PGliteInterfaceExtensions,
  PGliteOptions,
} from '../interface.js'
import type { PGlite } from '../pglite.js'
import { BasePGlite } from '../base.js'
import { uuid } from '../utils.js'

export type PGliteWorkerOptions = PGliteOptions & {
  meta?: any
  id?: string
}

export class PGliteWorker
  extends BasePGlite
  implements PGliteInterface, AsyncDisposable
{
  #initPromise: Promise<void>
  #debug: DebugLevel = 0

  #ready = false
  #closed = false
  #isLeader = false

  #eventTarget = new EventTarget()

  #tabId: string

  #connected = false

  #workerProcess: Worker
  #workerID?: string
  #workerHerePromise?: Promise<void>
  #workerReadyPromise?: Promise<void>

  #broadcastChannel?: BroadcastChannel
  #tabChannel?: BroadcastChannel
  #releaseTabCloseLock?: () => void

  #notifyListeners = new Map<string, Set<(payload: string) => void>>()
  #globalNotifyListeners = new Set<(channel: string, payload: string) => void>()

  #extensions: Extensions
  #extensionsClose: Array<() => Promise<void>> = []

  constructor(worker: Worker, options?: PGliteWorkerOptions) {
    super()
    this.#workerProcess = worker
    this.#tabId = uuid()
    this.#extensions = options?.extensions ?? {}

    this.#workerHerePromise = new Promise<void>((resolve) => {
      this.#workerProcess.addEventListener(
        'message',
        (event) => {
          if (event.data.type === 'here') {
            resolve()
          } else {
            throw new Error('Invalid message')
          }
        },
        { once: true },
      )
    })

    this.#workerReadyPromise = new Promise<void>((resolve) => {
      const callback = (event: MessageEvent<any>) => {
        if (event.data.type === 'ready') {
          this.#workerID = event.data.id
          this.#workerProcess.removeEventListener('message', callback)
          resolve()
        }
      }
      this.#workerProcess.addEventListener('message', callback)
    })

    this.#initPromise = this.#init(options)
  }

  /**
   * Create a new PGlite instance with extensions on the Typescript interface
   * This also awaits the instance to be ready before resolving
   * (The main constructor does enable extensions, however due to the limitations
   * of Typescript, the extensions are not available on the instance interface)
   * @param worker The worker to use
   * @param options Optional options
   * @returns A promise that resolves to the PGlite instance when it's ready.
   */
  static async create<O extends PGliteWorkerOptions>(
    worker: Worker,
    options?: O,
  ): Promise<PGliteWorker & PGliteInterfaceExtensions<O['extensions']>> {
    const pg = new PGliteWorker(worker, options)
    await pg.#initPromise
    return pg as PGliteWorker & PGliteInterfaceExtensions<O['extensions']>
  }

  async #init(options: PGliteWorkerOptions = {}) {
    // Setup the extensions
    for (const [extName, ext] of Object.entries(this.#extensions)) {
      if (ext instanceof URL) {
        throw new Error(
          'URL extensions are not supported on the client side of a worker',
        )
      } else {
        const extRet = await ext.setup(this, {}, true)
        if (extRet.emscriptenOpts) {
          console.warn(
            `PGlite extension ${extName} returned emscriptenOpts, these are not supported on the client side of a worker`,
          )
        }
        if (extRet.namespaceObj) {
          const instance = this as any
          instance[extName] = extRet.namespaceObj
        }
        if (extRet.bundlePath) {
          console.warn(
            `PGlite extension ${extName} returned bundlePath, this is not supported on the client side of a worker`,
          )
        }
        if (extRet.init) {
          await extRet.init()
        }
        if (extRet.close) {
          this.#extensionsClose.push(extRet.close)
        }
      }
    }

    // Wait for the worker let us know it's here
    await this.#workerHerePromise

    // Send the worker the options
    const { extensions: _, ...workerOptions } = options
    this.#workerProcess.postMessage({
      type: 'init',
      options: workerOptions,
    })

    // Wait for the worker let us know it's ready
    await this.#workerReadyPromise

    // Acquire the tab close lock, this is released then the tab, or this
    // PGliteWorker instance, is closed
    const tabCloseLockId = `pglite-tab-close:${this.#tabId}`
    this.#releaseTabCloseLock = await acquireLock(tabCloseLockId)

    // Start the broadcast channel used to communicate with tabs and leader election
    const broadcastChannelId = `pglite-broadcast:${this.#workerID}`
    this.#broadcastChannel = new BroadcastChannel(broadcastChannelId)

    // Start the tab channel used to communicate with the leader directly
    const tabChannelId = `pglite-tab:${this.#tabId}`
    this.#tabChannel = new BroadcastChannel(tabChannelId)

    this.#broadcastChannel.addEventListener('message', async (event) => {
      if (event.data.type === 'leader-here') {
        this.#connected = false
        this.#eventTarget.dispatchEvent(new Event('leader-change'))
        this.#leaderNotifyLoop()
      } else if (event.data.type === 'notify') {
        this.#receiveNotification(event.data.channel, event.data.payload)
      }
    })

    this.#tabChannel.addEventListener('message', async (event) => {
      if (event.data.type === 'connected') {
        this.#connected = true
        this.#eventTarget.dispatchEvent(new Event('connected'))
        this.#debug = await this.#rpc('getDebugLevel')
        this.#ready = true
      }
    })

    this.#workerProcess.addEventListener('message', async (event) => {
      if (event.data.type === 'leader-now') {
        this.#isLeader = true
        this.#eventTarget.dispatchEvent(new Event('leader-change'))
      }
    })

    this.#leaderNotifyLoop()

    // Init array types
    // We don't await this as it will result in a deadlock
    // It immediately takes out the transaction lock as so another query
    this._initArrayTypes()
  }

  async #leaderNotifyLoop() {
    if (!this.#connected) {
      this.#broadcastChannel!.postMessage({
        type: 'tab-here',
        id: this.#tabId,
      })
      setTimeout(() => this.#leaderNotifyLoop(), 16)
    }
  }

  async #rpc<Method extends WorkerRpcMethod>(
    method: Method,
    ...args: Parameters<WorkerApi[Method]>
  ): Promise<ReturnType<WorkerApi[Method]>> {
    const callId = uuid()
    const message: WorkerRpcCall<Method> = {
      type: 'rpc-call',
      callId,
      method,
      args,
    }
    this.#tabChannel!.postMessage(message)
    return await new Promise<ReturnType<WorkerApi[Method]>>(
      (resolve, reject) => {
        const listener = (event: MessageEvent) => {
          if (event.data.callId !== callId) return
          cleanup()
          const message: WorkerRpcResponse<Method> = event.data
          if (message.type === 'rpc-return') {
            resolve(message.result)
          } else if (message.type === 'rpc-error') {
            const error = new Error(message.error.message)
            Object.assign(error, message.error)
            reject(error)
          } else {
            reject(new Error('Invalid message'))
          }
        }
        const leaderChangeListener = () => {
          // If the leader changes, throw an error to reject the promise
          cleanup()
          reject(new LeaderChangedError())
        }
        const cleanup = () => {
          this.#tabChannel!.removeEventListener('message', listener)
          this.#eventTarget.removeEventListener(
            'leader-change',
            leaderChangeListener,
          )
        }
        this.#eventTarget.addEventListener(
          'leader-change',
          leaderChangeListener,
        )
        this.#tabChannel!.addEventListener('message', listener)
      },
    )
  }

  get waitReady() {
    return new Promise<void>((resolve) => {
      this.#initPromise.then(() => {
        if (!this.#connected) {
          resolve(
            new Promise<void>((resolve) => {
              this.#eventTarget.addEventListener('connected', () => {
                resolve()
              })
            }),
          )
        } else {
          resolve()
        }
      })
    })
  }

  get debug() {
    return this.#debug
  }

  /**
   * The ready state of the database
   */
  get ready() {
    return this.#ready
  }

  /**
   * The closed state of the database
   */
  get closed() {
    return this.#closed
  }

  /**
   * The leader state of this tab
   */
  get isLeader() {
    return this.#isLeader
  }

  /**
   * Close the database
   * @returns Promise that resolves when the connection to shared PGlite is closed
   */
  async close() {
    if (this.#closed) {
      return
    }
    this.#closed = true
    this.#broadcastChannel?.close()
    this.#tabChannel?.close()
    this.#releaseTabCloseLock?.()
    this.#workerProcess.terminate()
  }

  /**
   * Close the database when the object exits scope
   * Stage 3 ECMAScript Explicit Resource Management
   * https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-2.html#using-declarations-and-explicit-resource-management
   */
  async [Symbol.asyncDispose]() {
    await this.close()
  }

  /**
   * Execute a postgres wire protocol message directly without wrapping the response.
   * Only use if `execProtocol()` doesn't suite your needs.
   *
   * **Warning:** This bypasses PGlite's protocol wrappers that manage error/notice messages,
   * transactions, and notification listeners. Only use if you need to bypass these wrappers and
   * don't intend to use the above features.
   *
   * @param message The postgres wire protocol message to execute
   * @returns The direct message data response produced by Postgres
   */
  async execProtocolRaw(message: Uint8Array): Promise<Uint8Array> {
    return (await this.#rpc('execProtocolRaw', message)) as Uint8Array
  }

  /**
   * Execute a postgres wire protocol message
   * @param message The postgres wire protocol message to execute
   * @returns The result of the query
   */
  async execProtocol(message: Uint8Array): Promise<ExecProtocolResult> {
    return await this.#rpc('execProtocol', message)
  }

  /**
   * Sync the database to the filesystem
   * @returns Promise that resolves when the database is synced to the filesystem
   */
  async syncToFs() {
    await this.#rpc('syncToFs')
  }

  /**
   * Listen for a notification
   * @param channel The channel to listen on
   * @param callback The callback to call when a notification is received
   */
  async listen(
    channel: string,
    callback: (payload: string) => void,
  ): Promise<() => Promise<void>> {
    await this.waitReady
    if (!this.#notifyListeners.has(channel)) {
      this.#notifyListeners.set(channel, new Set())
    }
    this.#notifyListeners.get(channel)?.add(callback)
    await this.exec(`LISTEN ${channel}`)
    return async () => {
      await this.unlisten(channel, callback)
    }
  }

  /**
   * Stop listening for a notification
   * @param channel The channel to stop listening on
   * @param callback The callback to remove
   */
  async unlisten(
    channel: string,
    callback?: (payload: string) => void,
  ): Promise<void> {
    await this.waitReady
    if (callback) {
      this.#notifyListeners.get(channel)?.delete(callback)
    } else {
      this.#notifyListeners.delete(channel)
    }
    if (this.#notifyListeners.get(channel)?.size === 0) {
      // As we currently have a dedicated worker we can just unlisten
      await this.exec(`UNLISTEN ${channel}`)
    }
  }

  /**
   * Listen to notifications
   * @param callback The callback to call when a notification is received
   */
  onNotification(callback: (channel: string, payload: string) => void) {
    this.#globalNotifyListeners.add(callback)
    return () => {
      this.#globalNotifyListeners.delete(callback)
    }
  }

  /**
   * Stop listening to notifications
   * @param callback The callback to remove
   */
  offNotification(callback: (channel: string, payload: string) => void) {
    this.#globalNotifyListeners.delete(callback)
  }

  #receiveNotification(channel: string, payload: string) {
    const listeners = this.#notifyListeners.get(channel)
    if (listeners) {
      for (const listener of listeners) {
        queueMicrotask(() => listener(payload))
      }
    }
    for (const listener of this.#globalNotifyListeners) {
      queueMicrotask(() => listener(channel, payload))
    }
  }

  async dumpDataDir(): Promise<File | Blob> {
    return (await this.#rpc('dumpDataDir')) as File | Blob
  }

  onLeaderChange(callback: () => void) {
    this.#eventTarget.addEventListener('leader-change', callback)
    return () => {
      this.#eventTarget.removeEventListener('leader-change', callback)
    }
  }

  offLeaderChange(callback: () => void) {
    this.#eventTarget.removeEventListener('leader-change', callback)
  }

  async _handleBlob(blob?: File | Blob): Promise<void> {
    await this.#rpc('_handleBlob', blob)
  }

  async _getWrittenBlob(): Promise<File | Blob | undefined> {
    return await this.#rpc('_getWrittenBlob')
  }

  async _cleanupBlob(): Promise<void> {
    await this.#rpc('_cleanupBlob')
  }

  async _checkReady() {
    await this.waitReady
  }

  async _runExclusiveQuery<T>(fn: () => Promise<T>): Promise<T> {
    await this.#rpc('_acquireQueryLock')
    try {
      return await fn()
    } finally {
      await this.#rpc('_releaseQueryLock')
    }
  }

  async _runExclusiveTransaction<T>(fn: () => Promise<T>): Promise<T> {
    await this.#rpc('_acquireTransactionLock')
    try {
      return await fn()
    } finally {
      await this.#rpc('_releaseTransactionLock')
    }
  }
}

export interface WorkerOptions {
  init: (options: Exclude<PGliteWorkerOptions, 'extensions'>) => Promise<PGlite>
}

export async function worker({ init }: WorkerOptions) {
  // Send a message to the main thread to let it know we are here
  postMessage({ type: 'here' })

  // Await the main thread to send us the options
  const options = await new Promise<Exclude<PGliteWorkerOptions, 'extensions'>>(
    (resolve) => {
      addEventListener(
        'message',
        (event) => {
          if (event.data.type === 'init') {
            resolve(event.data.options)
          }
        },
        { once: true },
      )
    },
  )

  // ID for this multi-tab worker - this is used to identify the group of workers
  // that are trying to elect a leader for a shared PGlite instance.
  // It defaults to the URL of the worker, and the dataDir if provided
  // but can be overridden by the options.
  const id = options.id ?? `${import.meta.url}:${options.dataDir ?? ''}`

  // Let the main thread know we are ready
  postMessage({ type: 'ready', id })

  const electionLockId = `pglite-election-lock:${id}`
  const broadcastChannelId = `pglite-broadcast:${id}`
  const broadcastChannel = new BroadcastChannel(broadcastChannelId)
  const connectedTabs = new Set<string>()

  // Await the main lock which is used to elect the leader
  // We don't release this lock, its automatically released when the worker or
  // tab is closed
  await acquireLock(electionLockId)

  // Now we are the leader, start the worker
  const dbPromise = init(options)

  // Start listening for messages from tabs
  broadcastChannel.onmessage = async (event) => {
    const msg = event.data
    switch (msg.type) {
      case 'tab-here':
        // A new tab has joined,
        connectTab(msg.id, await dbPromise, connectedTabs)
        break
    }
  }

  // Notify the other tabs that we are the leader
  broadcastChannel.postMessage({ type: 'leader-here', id })

  // Let the main thread know we are the leader
  postMessage({ type: 'leader-now' })

  const db = await dbPromise

  // Listen for notifications and broadcast them to all tabs
  db.onNotification((channel, payload) => {
    broadcastChannel.postMessage({ type: 'notify', channel, payload })
  })
}

function connectTab(tabId: string, pg: PGlite, connectedTabs: Set<string>) {
  if (connectedTabs.has(tabId)) {
    return
  }
  connectedTabs.add(tabId)
  const tabChannelId = `pglite-tab:${tabId}`
  const tabCloseLockId = `pglite-tab-close:${tabId}`
  const tabChannel = new BroadcastChannel(tabChannelId)

  // Use a tab close lock to unsubscribe the tab
  navigator.locks.request(tabCloseLockId, () => {
    return new Promise<void>((resolve) => {
      // The tab has been closed, unsubscribe the tab broadcast channel
      tabChannel.close()
      connectedTabs.delete(tabId)
      resolve()
    })
  })

  const api = makeWorkerApi(tabId, pg)

  tabChannel.addEventListener('message', async (event) => {
    const msg = event.data
    switch (msg.type) {
      case 'rpc-call': {
        await pg.waitReady
        const { callId, method, args } = msg as WorkerRpcCall<WorkerRpcMethod>
        try {
          // @ts-ignore no apparent reason why it fails
          const result = (await api[method](...args)) as WorkerRpcResult<
            typeof method
          >['result']
          tabChannel.postMessage({
            type: 'rpc-return',
            callId,
            result,
          } satisfies WorkerRpcResult<typeof method>)
        } catch (error) {
          console.error(error)
          tabChannel.postMessage({
            type: 'rpc-error',
            callId,
            error: { message: (error as Error).message },
          } satisfies WorkerRpcError)
        }
        break
      }
    }
  })

  // Send a message to the tab to let it know it's connected
  tabChannel.postMessage({ type: 'connected' })
}

function makeWorkerApi(tabId: string, db: PGlite) {
  let queryLockRelease: (() => void) | null = null
  let transactionLockRelease: (() => void) | null = null

  // If the tab is closed and it is holding a lock, release the the locks
  // and rollback any pending transactions
  const tabCloseLockId = `pglite-tab-close:${tabId}`
  acquireLock(tabCloseLockId).then(() => {
    if (transactionLockRelease) {
      // rollback any pending transactions
      db.exec('ROLLBACK')
    }
    queryLockRelease?.()
    transactionLockRelease?.()
  })

  return {
    async getDebugLevel() {
      return db.debug
    },
    async close() {
      await db.close()
    },
    async execProtocol(message: Uint8Array) {
      const { messages, data } = await db.execProtocol(message)
      if (data.byteLength !== data.buffer.byteLength) {
        const buffer = new ArrayBuffer(data.byteLength)
        const dataCopy = new Uint8Array(buffer)
        dataCopy.set(data)
        return { messages, data: dataCopy }
      } else {
        return { messages, data }
      }
    },
    async execProtocolRaw(message: Uint8Array) {
      const result = await db.execProtocolRaw(message)
      if (result.byteLength !== result.buffer.byteLength) {
        // The data is a slice of a larger buffer, this is potentially the whole
        // memory of the WASM module. We copy it to a new Uint8Array and return that.
        const buffer = new ArrayBuffer(result.byteLength)
        const resultCopy = new Uint8Array(buffer)
        resultCopy.set(result)
        return resultCopy
      } else {
        return result
      }
    },
    async dumpDataDir() {
      return await db.dumpDataDir()
    },
    async syncToFs() {
      return await db.syncToFs()
    },
    async _handleBlob(blob?: File | Blob) {
      return await db._handleBlob(blob)
    },
    async _getWrittenBlob() {
      return await db._getWrittenBlob()
    },
    async _cleanupBlob() {
      return await db._cleanupBlob()
    },
    async _checkReady() {
      return await db._checkReady()
    },
    async _acquireQueryLock() {
      return new Promise<void>((resolve) => {
        db._runExclusiveQuery(() => {
          return new Promise<void>((release) => {
            queryLockRelease = release
            resolve()
          })
        })
      })
    },
    async _releaseQueryLock() {
      queryLockRelease?.()
      queryLockRelease = null
    },
    async _acquireTransactionLock() {
      return new Promise<void>((resolve) => {
        db._runExclusiveTransaction(() => {
          return new Promise<void>((release) => {
            transactionLockRelease = release
            resolve()
          })
        })
      })
    },
    async _releaseTransactionLock() {
      transactionLockRelease?.()
      transactionLockRelease = null
    },
  }
}

export class LeaderChangedError extends Error {
  constructor() {
    super('Leader changed, pending operation in indeterminate state')
  }
}

async function acquireLock(lockId: string) {
  let release
  await new Promise<void>((resolve) => {
    navigator.locks.request(lockId, () => {
      return new Promise<void>((releaseCallback) => {
        release = releaseCallback
        resolve()
      })
    })
  })
  return release
}

type WorkerApi = ReturnType<typeof makeWorkerApi>

type WorkerRpcMethod = keyof WorkerApi

type WorkerRpcCall<Method extends WorkerRpcMethod> = {
  type: 'rpc-call'
  callId: string
  method: Method
  args: Parameters<WorkerApi[Method]>
}

type WorkerRpcResult<Method extends WorkerRpcMethod> = {
  type: 'rpc-return'
  callId: string
  result: ReturnType<WorkerApi[Method]>
}

type WorkerRpcError = {
  type: 'rpc-error'
  callId: string
  error: any
}

type WorkerRpcResponse<Method extends WorkerRpcMethod> =
  | WorkerRpcResult<Method>
  | WorkerRpcError
