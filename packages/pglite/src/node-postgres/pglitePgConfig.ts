import { EventEmitter } from 'events'
import type { PGlite } from '../pglite'
import { serialize } from '@electric-sql/pg-protocol'

export interface Config {
  pglite: PGlite
}

export class PGlitePgConfig {
  constructor(config: Config) {
    this.connection = new PglitePgConnection({ pglite: config.pglite })
  }

  public readonly connection: PglitePgConnection
  public readonly poolSize = 1 // PGlite is single connection at the moment
  public readonly password = 'dummy' // PGlite accepts any password
  public readonly user = 'postgres' // dummy
  public readonly database = 'postgres' // dummy
  public readonly port = 5432 // dummy
  public readonly host = 'localhost' // dummy
}

export class PglitePgConnection extends EventEmitter {
  #pglite: PGlite
  #emitMessage: boolean = false
  #queue: Promise<void> = Promise.resolve()

  // checked by pg's Client.end(), which skips connection.end() without it
  public _connecting = false

  // pg's Client.end() destroys the stream when a query is still active
  public readonly stream = { destroy: () => this.end() }

  #send(buffer: any) {
    this.#queue = this.#queue
      .then(() =>
        this.#pglite.execProtocolStream(buffer, { throwOnError: false }),
      )
      .then((messages) => {
        messages.forEach((m) => {
          if (this.#emitMessage) {
            this.emit('message', m)
          }
          // node-postgres expects ErrorResponse as 'errorMessage'
          this.emit(m.name === 'error' ? 'errorMessage' : m.name, m)
        })
      })
      .catch((err) => {
        this.emit('error', err)
      })
  }

  public parsedStatements = {}
  public submittedNamedStatements = {}

  constructor(config: Config) {
    super()
    this.#pglite = config.pglite

    this.on('newListener', (eventName) => {
      if (eventName === 'message') {
        this.#emitMessage = true
      }
    })
  }

  async connect(_port: number, _host: string) {
    this._connecting = true
    await this.#pglite.waitReady
    process.nextTick(() => this.emit('readyForQuery'))
  }

  requestSsl() {
    // dummy
  }

  startup(_config: any) {
    // dummy
  }

  cancel(_processID: any, _secretKey: any) {
    // dummy
  }

  password(_password: string) {
    // dummy
  }

  sendSASLInitialResponseMessage(mechanism: any, initialResponse: any) {
    this.#send(
      serialize.sendSASLInitialResponseMessage(mechanism, initialResponse),
    )
  }

  sendSCRAMClientFinalMessage(additionalData: any) {
    this.#send(serialize.sendSCRAMClientFinalMessage(additionalData))
  }

  query(text: string) {
    this.#send(serialize.query(text))
  }

  parse(query: any) {
    // throw new Error('Not implemented')
    this.#send(serialize.parse(query))
  }

  bind(config: any) {
    this.#send(serialize.bind(config))
  }

  execute(config: any) {
    this.#send(serialize.execute(config))
  }

  flush() {
    this.#send(serialize.flush())
  }

  sync() {
    this.#send(serialize.sync())
  }

  end() {
    // like a socket closing: pg waits for 'end'. The PGlite instance is
    // shared and owned by the caller, so it stays open.
    this.#queue = this.#queue.then(() => {
      this.emit('end')
    })
    // the pool reuses this connection for its next client: drop the
    // ended client's listeners so they don't receive its messages
    this.eventNames()
      .filter((e) => e !== 'newListener')
      .forEach((e) => this.removeAllListeners(e))
    this.#emitMessage = false
  }

  close(msg: any) {
    this.#send(serialize.close(msg))
  }

  describe(msg: any) {
    this.#send(serialize.describe(msg))
  }

  sendCopyFromChunk(chunk: any) {
    this.#send(serialize.copyData(chunk))
  }

  endCopyFrom() {
    this.#send(serialize.copyDone())
  }

  sendCopyFail(msg: any) {
    this.#send(serialize.copyFail(msg))
  }

  ref() {
    // dummy
  }

  unref() {
    // dummy
  }
}
