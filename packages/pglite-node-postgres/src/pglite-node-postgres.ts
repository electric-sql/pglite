import { EventEmitter } from 'events'
import { PGlite } from '@electric-sql/pglite'
import { serialize } from '@electric-sql/pg-protocol'

export interface Config {
  pglite: PGlite
}

export class PGlitePgConfig {
  constructor(config: Config) {
    this.connection = new Connection({ pglite: config.pglite })
  }

  public readonly connection: Connection
  public readonly poolSize = 1 // PGlite is single connection at the moment
  public readonly password = 'dummy' // PGlite accepts any password
  public readonly user = 'postgres' // dummy
  public readonly database = 'postgres' // dummy
  public readonly port = 5432 // dummy
  public readonly host = 'localhost' // dummy
}

export class Connection extends EventEmitter {
  #pglite: PGlite
  #emitMessage: boolean = false
  #queue: Promise<void> = Promise.resolve()

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

  constructor(config: Config) {
    super()
    this.#pglite = config.pglite

    this.on('newListener', (eventName) => {
      if (eventName === 'message') {
        this.#emitMessage = true
      }
    })
  }

  connect(_port: number, _host: string) {
    // dummy
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

  async end() {
    // 0x58 = 'X'
    await this.#pglite.close()
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
