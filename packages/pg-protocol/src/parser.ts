import {
  bindComplete,
  parseComplete,
  closeComplete,
  noData,
  portalSuspended,
  copyDone,
  replicationStart,
  emptyQuery,
  ReadyForQueryMessage,
  CommandCompleteMessage,
  CopyDataMessage,
  CopyResponse,
  NotificationResponseMessage,
  RowDescriptionMessage,
  ParameterDescriptionMessage,
  Field,
  DataRowMessage,
  ParameterStatusMessage,
  BackendKeyDataMessage,
  DatabaseError,
  BackendMessage,
  MessageName,
  NoticeMessage,
  AuthenticationMessage,
  AuthenticationOk,
  AuthenticationCleartextPassword,
  AuthenticationMD5Password,
  AuthenticationSASL,
  AuthenticationSASLContinue,
  AuthenticationSASLFinal,
} from './messages'
import { BufferParameter, Modes } from './types'
import { BufferReader } from './buffer-reader'

// every message is prefixed with a single bye
const CODE_LENGTH = 1 as const
// every message has an int32 length which includes itself but does
// NOT include the code in the length
const LEN_LENGTH = 4 as const

const HEADER_LENGTH = CODE_LENGTH + LEN_LENGTH

export type Packet = {
  code: number
  packet: ArrayBuffer
}

const emptyBuffer = new ArrayBuffer(0)

const enum MessageCodes {
  DataRow = 0x44, // D
  ParseComplete = 0x31, // 1
  BindComplete = 0x32, // 2
  CloseComplete = 0x33, // 3
  CommandComplete = 0x43, // C
  ReadyForQuery = 0x5a, // Z
  NoData = 0x6e, // n
  NotificationResponse = 0x41, // A
  AuthenticationResponse = 0x52, // R
  ParameterStatus = 0x53, // S
  BackendKeyData = 0x4b, // K
  ErrorMessage = 0x45, // E
  NoticeMessage = 0x4e, // N
  RowDescriptionMessage = 0x54, // T
  ParameterDescriptionMessage = 0x74, // t
  PortalSuspended = 0x73, // s
  ReplicationStart = 0x57, // W
  EmptyQuery = 0x49, // I
  CopyIn = 0x47, // G
  CopyOut = 0x48, // H
  CopyDone = 0x63, // c
  CopyData = 0x64, // d
}

export type MessageCallback = (msg: BackendMessage) => void

export class Parser {
  #bufferView: DataView = new DataView(emptyBuffer)
  #bufferRemainingLength: number = 0
  #bufferOffset: number = 0
  #reader = new BufferReader()

  public parse(buffer: BufferParameter, callback: MessageCallback) {
    this.#mergeBuffer(
      ArrayBuffer.isView(buffer)
        ? buffer.buffer.slice(
            buffer.byteOffset,
            buffer.byteOffset + buffer.byteLength,
          )
        : buffer,
    )
    const bufferFullLength = this.#bufferOffset + this.#bufferRemainingLength
    let offset = this.#bufferOffset
    while (offset + HEADER_LENGTH <= bufferFullLength) {
      // code is 1 byte long - it identifies the message type
      const code = this.#bufferView.getUint8(offset)
      // length is 1 Uint32BE - it is the length of the message EXCLUDING the code
      const length = this.#bufferView.getUint32(offset + CODE_LENGTH, false)
      const fullMessageLength = CODE_LENGTH + length
      if (fullMessageLength + offset <= bufferFullLength) {
        const message = this.#handlePacket(
          offset + HEADER_LENGTH,
          code,
          length,
          this.#bufferView.buffer,
        )
        callback(message)
        offset += fullMessageLength
      } else {
        break
      }
    }
    if (offset === bufferFullLength) {
      // No more use for the buffer
      this.#bufferView = new DataView(emptyBuffer)
      this.#bufferRemainingLength = 0
      this.#bufferOffset = 0
    } else {
      // Adjust the cursors of remainingBuffer
      this.#bufferRemainingLength = bufferFullLength - offset
      this.#bufferOffset = offset
    }
  }

  #mergeBuffer(buffer: ArrayBuffer): void {
    if (this.#bufferRemainingLength > 0) {
      const newLength = this.#bufferRemainingLength + buffer.byteLength
      const newFullLength = newLength + this.#bufferOffset
      if (newFullLength > this.#bufferView.byteLength) {
        // We can't concat the new buffer with the remaining one
        let newBuffer: ArrayBuffer
        if (
          newLength <= this.#bufferView.byteLength &&
          this.#bufferOffset >= this.#bufferRemainingLength
        ) {
          // We can move the relevant part to the beginning of the buffer instead of allocating a new buffer
          newBuffer = this.#bufferView.buffer
        } else {
          // Allocate a new larger buffer
          let newBufferLength = this.#bufferView.byteLength * 2
          while (newLength >= newBufferLength) {
            newBufferLength *= 2
          }
          newBuffer = new ArrayBuffer(newBufferLength)
        }
        // Move the remaining buffer to the new one
        new Uint8Array(newBuffer).set(
          new Uint8Array(
            this.#bufferView.buffer,
            this.#bufferOffset,
            this.#bufferRemainingLength,
          ),
        )
        this.#bufferView = new DataView(newBuffer)
        this.#bufferOffset = 0
      }

      // Concat the new buffer with the remaining one
      new Uint8Array(this.#bufferView.buffer).set(
        new Uint8Array(buffer),
        this.#bufferOffset + this.#bufferRemainingLength,
      )
      this.#bufferRemainingLength = newLength
    } else {
      this.#bufferView = new DataView(buffer)
      this.#bufferOffset = 0
      this.#bufferRemainingLength = buffer.byteLength
    }
  }

  #handlePacket(
    offset: number,
    code: number,
    length: number,
    bytes: ArrayBuffer,
  ): BackendMessage {
    switch (code) {
      case MessageCodes.BindComplete:
        return bindComplete
      case MessageCodes.ParseComplete:
        return parseComplete
      case MessageCodes.CloseComplete:
        return closeComplete
      case MessageCodes.NoData:
        return noData
      case MessageCodes.PortalSuspended:
        return portalSuspended
      case MessageCodes.CopyDone:
        return copyDone
      case MessageCodes.ReplicationStart:
        return replicationStart
      case MessageCodes.EmptyQuery:
        return emptyQuery
      case MessageCodes.DataRow:
        return this.#parseDataRowMessage(offset, length, bytes)
      case MessageCodes.CommandComplete:
        return this.#parseCommandCompleteMessage(offset, length, bytes)
      case MessageCodes.ReadyForQuery:
        return this.#parseReadyForQueryMessage(offset, length, bytes)
      case MessageCodes.NotificationResponse:
        return this.#parseNotificationMessage(offset, length, bytes)
      case MessageCodes.AuthenticationResponse:
        return this.#parseAuthenticationResponse(offset, length, bytes)
      case MessageCodes.ParameterStatus:
        return this.#parseParameterStatusMessage(offset, length, bytes)
      case MessageCodes.BackendKeyData:
        return this.#parseBackendKeyData(offset, length, bytes)
      case MessageCodes.ErrorMessage:
        return this.#parseErrorMessage(offset, length, bytes, 'error')
      case MessageCodes.NoticeMessage:
        return this.#parseErrorMessage(offset, length, bytes, 'notice')
      case MessageCodes.RowDescriptionMessage:
        return this.#parseRowDescriptionMessage(offset, length, bytes)
      case MessageCodes.ParameterDescriptionMessage:
        return this.#parseParameterDescriptionMessage(offset, length, bytes)
      case MessageCodes.CopyIn:
        return this.#parseCopyInMessage(offset, length, bytes)
      case MessageCodes.CopyOut:
        return this.#parseCopyOutMessage(offset, length, bytes)
      case MessageCodes.CopyData:
        return this.#parseCopyData(offset, length, bytes)
      default:
        return new DatabaseError(
          'received invalid response: ' + code.toString(16),
          length,
          'error',
        )
    }
  }

  #parseReadyForQueryMessage(
    offset: number,
    length: number,
    bytes: ArrayBuffer,
  ) {
    this.#reader.setBuffer(offset, bytes)
    const status = this.#reader.string(1)
    return new ReadyForQueryMessage(length, status)
  }

  #parseCommandCompleteMessage(
    offset: number,
    length: number,
    bytes: ArrayBuffer,
  ) {
    this.#reader.setBuffer(offset, bytes)
    const text = this.#reader.cstring()
    return new CommandCompleteMessage(length, text)
  }

  #parseCopyData(offset: number, length: number, bytes: ArrayBuffer) {
    const chunk = bytes.slice(offset, offset + (length - 4))
    return new CopyDataMessage(length, new Uint8Array(chunk))
  }

  #parseCopyInMessage(offset: number, length: number, bytes: ArrayBuffer) {
    return this.#parseCopyMessage(offset, length, bytes, 'copyInResponse')
  }

  #parseCopyOutMessage(offset: number, length: number, bytes: ArrayBuffer) {
    return this.#parseCopyMessage(offset, length, bytes, 'copyOutResponse')
  }

  #parseCopyMessage(
    offset: number,
    length: number,
    bytes: ArrayBuffer,
    messageName: MessageName,
  ) {
    this.#reader.setBuffer(offset, bytes)
    const isBinary = this.#reader.byte() !== 0
    const columnCount = this.#reader.int16()
    const message = new CopyResponse(length, messageName, isBinary, columnCount)
    for (let i = 0; i < columnCount; i++) {
      message.columnTypes[i] = this.#reader.int16()
    }
    return message
  }

  #parseNotificationMessage(
    offset: number,
    length: number,
    bytes: ArrayBuffer,
  ) {
    this.#reader.setBuffer(offset, bytes)
    const processId = this.#reader.int32()
    const channel = this.#reader.cstring()
    const payload = this.#reader.cstring()
    return new NotificationResponseMessage(length, processId, channel, payload)
  }

  #parseRowDescriptionMessage(
    offset: number,
    length: number,
    bytes: ArrayBuffer,
  ) {
    this.#reader.setBuffer(offset, bytes)
    const fieldCount = this.#reader.int16()
    const message = new RowDescriptionMessage(length, fieldCount)
    for (let i = 0; i < fieldCount; i++) {
      message.fields[i] = this.#parseField()
    }
    return message
  }

  #parseField(): Field {
    const name = this.#reader.cstring()
    const tableID = this.#reader.int32()
    const columnID = this.#reader.int16()
    const dataTypeID = this.#reader.int32()
    const dataTypeSize = this.#reader.int16()
    const dataTypeModifier = this.#reader.int32()
    const mode = this.#reader.int16() === 0 ? Modes.text : Modes.binary
    return new Field(
      name,
      tableID,
      columnID,
      dataTypeID,
      dataTypeSize,
      dataTypeModifier,
      mode,
    )
  }

  #parseParameterDescriptionMessage(
    offset: number,
    length: number,
    bytes: ArrayBuffer,
  ) {
    this.#reader.setBuffer(offset, bytes)
    const parameterCount = this.#reader.int16()
    const message = new ParameterDescriptionMessage(length, parameterCount)
    for (let i = 0; i < parameterCount; i++) {
      message.dataTypeIDs[i] = this.#reader.int32()
    }
    return message
  }

  #parseDataRowMessage(offset: number, length: number, bytes: ArrayBuffer) {
    this.#reader.setBuffer(offset, bytes)
    const fieldCount = this.#reader.int16()
    const fields: (string | null)[] = new Array(fieldCount)
    for (let i = 0; i < fieldCount; i++) {
      const len = this.#reader.int32()
      // a -1 for length means the value of the field is null
      fields[i] = len === -1 ? null : this.#reader.string(len)
    }
    return new DataRowMessage(length, fields)
  }

  #parseParameterStatusMessage(
    offset: number,
    length: number,
    bytes: ArrayBuffer,
  ) {
    this.#reader.setBuffer(offset, bytes)
    const name = this.#reader.cstring()
    const value = this.#reader.cstring()
    return new ParameterStatusMessage(length, name, value)
  }

  #parseBackendKeyData(offset: number, length: number, bytes: ArrayBuffer) {
    this.#reader.setBuffer(offset, bytes)
    const processID = this.#reader.int32()
    const secretKey = this.#reader.int32()
    return new BackendKeyDataMessage(length, processID, secretKey)
  }

  #parseAuthenticationResponse(
    offset: number,
    length: number,
    bytes: ArrayBuffer,
  ): AuthenticationMessage {
    this.#reader.setBuffer(offset, bytes)
    const code = this.#reader.int32()
    switch (code) {
      case 0:
        return new AuthenticationOk(length)
      case 3:
        return new AuthenticationCleartextPassword(length)

      case 5:
        return new AuthenticationMD5Password(length, this.#reader.bytes(4))

      case 10: {
        const mechanisms: string[] = []
        while (true) {
          const mechanism = this.#reader.cstring()
          if (mechanism.length === 0) {
            return new AuthenticationSASL(length, mechanisms)
          }
          mechanisms.push(mechanism)
        }
      }
      case 11:
        return new AuthenticationSASLContinue(
          length,
          this.#reader.string(length - 8),
        )

      case 12:
        return new AuthenticationSASLFinal(
          length,
          this.#reader.string(length - 8),
        )

      default:
        throw new Error('Unknown authenticationOk message type ' + code)
    }
  }

  #parseErrorMessage(
    offset: number,
    length: number,
    bytes: ArrayBuffer,
    name: MessageName,
  ) {
    this.#reader.setBuffer(offset, bytes)
    const fields: Record<string, string> = {}
    let fieldType = this.#reader.string(1)
    while (fieldType !== '\0') {
      fields[fieldType] = this.#reader.cstring()
      fieldType = this.#reader.string(1)
    }

    const messageValue = fields.M

    const message =
      name === 'notice'
        ? new NoticeMessage(length, messageValue)
        : new DatabaseError(messageValue, length, name)

    message.severity = fields.S
    message.code = fields.C
    message.detail = fields.D
    message.hint = fields.H
    message.position = fields.P
    message.internalPosition = fields.p
    message.internalQuery = fields.q
    message.where = fields.W
    message.schema = fields.s
    message.table = fields.t
    message.column = fields.c
    message.dataType = fields.d
    message.constraint = fields.n
    message.file = fields.F
    message.line = fields.L
    message.routine = fields.R
    return message
  }
}
