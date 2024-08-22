import { Writer } from './buffer-writer'
import { byteLengthUtf8 } from './string-utils'

const enum code {
  startup = 0x70,
  query = 0x51,
  parse = 0x50,
  bind = 0x42,
  execute = 0x45,
  flush = 0x48,
  sync = 0x53,
  end = 0x58,
  close = 0x43,
  describe = 0x44,
  copyFromChunk = 0x64,
  copyDone = 0x63,
  copyFail = 0x66,
}

const writer = new Writer()

const startup = (opts: Record<string, string>): ArrayBuffer => {
  // protocol version
  writer.addInt16(3).addInt16(0)
  for (const key of Object.keys(opts)) {
    writer.addCString(key).addCString(opts[key])
  }

  writer.addCString('client_encoding').addCString('UTF8')

  const bodyBuffer = writer.addCString('').flush()
  // this message is sent without a code

  const length = bodyBuffer.byteLength + 4

  return new Writer().addInt32(length).add(bodyBuffer).flush()
}

const requestSsl = (): ArrayBuffer => {
  const bufferView = new DataView(new ArrayBuffer(8))
  bufferView.setInt32(0, 8, false)
  bufferView.setInt32(4, 80877103, false)
  return bufferView.buffer
}

const password = (password: string): ArrayBuffer => {
  return writer.addCString(password).flush(code.startup)
}

const sendSASLInitialResponseMessage = function (
  mechanism: string,
  initialResponse: string,
): ArrayBuffer {
  // 0x70 = 'p'
  writer
    .addCString(mechanism)
    .addInt32(byteLengthUtf8(initialResponse))
    .addString(initialResponse)

  return writer.flush(code.startup)
}

const sendSCRAMClientFinalMessage = function (
  additionalData: string,
): ArrayBuffer {
  return writer.addString(additionalData).flush(code.startup)
}

const query = (text: string): ArrayBuffer => {
  return writer.addCString(text).flush(code.query)
}

type ParseOpts = {
  name?: string
  types?: number[]
  text: string
}

const emptyArray: any[] = []

const parse = (query: ParseOpts): ArrayBuffer => {
  // expect something like this:
  // { name: 'queryName',
  //   text: 'select * from blah',
  //   types: ['int8', 'bool'] }

  // normalize missing query names to allow for null
  const name = query.name || ''
  if (name.length > 63) {
    /* eslint-disable no-console */
    console.error(
      'Warning! Postgres only supports 63 characters for query names.',
    )
    console.error('You supplied %s (%s)', name, name.length)
    console.error(
      'This can cause conflicts and silent errors executing queries',
    )
    /* eslint-enable no-console */
  }

  const types = query.types || emptyArray

  const len = types.length

  const buffer = writer
    .addCString(name) // name of query
    .addCString(query.text) // actual query text
    .addInt16(len)

  for (let i = 0; i < len; i++) {
    buffer.addInt32(types[i])
  }

  return writer.flush(code.parse)
}

type ValueMapper = (param: any, index: number) => any

type BindOpts = {
  portal?: string
  binary?: boolean
  statement?: string
  values?: any[]
  // optional map from JS value to postgres value per parameter
  valueMapper?: ValueMapper
}

const paramWriter = new Writer()

// make this a const enum so typescript will inline the value
const enum ParamType {
  STRING = 0,
  BINARY = 1,
}

const writeValues = function (values: any[], valueMapper?: ValueMapper): void {
  for (let i = 0; i < values.length; i++) {
    const mappedVal = valueMapper ? valueMapper(values[i], i) : values[i]
    if (mappedVal === null || mappedVal === undefined) {
      // add the param type (string) to the writer
      writer.addInt16(ParamType.STRING)
      // write -1 to the param writer to indicate null
      paramWriter.addInt32(-1)
    } else if (
      mappedVal instanceof ArrayBuffer ||
      ArrayBuffer.isView(mappedVal)
    ) {
      const buffer = ArrayBuffer.isView(mappedVal)
        ? mappedVal.buffer
        : mappedVal
      // add the param type (binary) to the writer
      writer.addInt16(ParamType.BINARY)
      // add the buffer to the param writer
      paramWriter.addInt32(buffer.byteLength)
      paramWriter.add(buffer)
    } else {
      // add the param type (string) to the writer
      writer.addInt16(ParamType.STRING)
      paramWriter.addInt32(byteLengthUtf8(mappedVal))
      paramWriter.addString(mappedVal)
    }
  }
}

const bind = (config: BindOpts = {}): ArrayBuffer => {
  // normalize config
  const portal = config.portal || ''
  const statement = config.statement || ''
  const binary = config.binary || false
  const values = config.values || emptyArray
  const len = values.length

  writer.addCString(portal).addCString(statement)
  writer.addInt16(len)

  writeValues(values, config.valueMapper)

  writer.addInt16(len)
  writer.add(paramWriter.flush())

  // format code
  writer.addInt16(binary ? ParamType.BINARY : ParamType.STRING)
  return writer.flush(code.bind)
}

type ExecOpts = {
  portal?: string
  rows?: number
}

const emptyExecute = new Uint8Array([
  code.execute,
  0x00,
  0x00,
  0x00,
  0x09,
  0x00,
  0x00,
  0x00,
  0x00,
  0x00,
]).buffer

const execute = (config?: ExecOpts): ArrayBuffer => {
  // this is the happy path for most queries
  if (!config || (!config.portal && !config.rows)) {
    return emptyExecute
  }

  const portal = config.portal ?? ''
  const rows = config.rows ?? 0

  const portalLength = byteLengthUtf8(portal)
  const len = 4 + portalLength + 1 + 4
  // one extra bit for code
  const bufferView = new DataView(new ArrayBuffer(1 + len))
  bufferView.setUint8(0, code.execute)
  bufferView.setInt32(1, len, false)
  new TextEncoder().encodeInto(portal, new Uint8Array(bufferView.buffer, 5))
  bufferView.setUint8(portalLength + 5, 0) // null terminate portal cString
  bufferView.setUint32(bufferView.byteLength - 4, rows, false)
  return bufferView.buffer
}

const cancel = (processID: number, secretKey: number): ArrayBuffer => {
  const bufferView = new DataView(new ArrayBuffer(16))
  bufferView.setInt32(0, 16, false)
  bufferView.setInt16(4, 1234, false)
  bufferView.setInt16(6, 5678, false)
  bufferView.setInt32(8, processID, false)
  bufferView.setInt32(12, secretKey, false)
  return bufferView.buffer
}

type PortalOpts = {
  type: 'S' | 'P'
  name?: string
}

const cstringMessage = (code: code, string: string): ArrayBuffer => {
  const writer = new Writer()
  writer.addCString(string)
  return writer.flush(code)
}

const emptyDescribePortal = writer.addCString('P').flush(code.describe)
const emptyDescribeStatement = writer.addCString('S').flush(code.describe)

const describe = (msg: PortalOpts): ArrayBuffer => {
  return msg.name
    ? cstringMessage(code.describe, `${msg.type}${msg.name || ''}`)
    : msg.type === 'P'
      ? emptyDescribePortal
      : emptyDescribeStatement
}

const close = (msg: PortalOpts): ArrayBuffer => {
  const text = `${msg.type}${msg.name || ''}`
  return cstringMessage(code.close, text)
}

const copyData = (chunk: ArrayBuffer): ArrayBuffer => {
  return writer.add(chunk).flush(code.copyFromChunk)
}

const copyFail = (message: string): ArrayBuffer => {
  return cstringMessage(code.copyFail, message)
}

const codeOnlyBuffer = (code: code): ArrayBuffer =>
  new Uint8Array([code, 0x00, 0x00, 0x00, 0x04]).buffer

const flushBuffer = codeOnlyBuffer(code.flush)
const syncBuffer = codeOnlyBuffer(code.sync)
const endBuffer = codeOnlyBuffer(code.end)
const copyDoneBuffer = codeOnlyBuffer(code.copyDone)

const serialize = {
  startup,
  password,
  requestSsl,
  sendSASLInitialResponseMessage,
  sendSCRAMClientFinalMessage,
  query,
  parse,
  bind,
  execute,
  describe,
  close,
  flush: () => flushBuffer,
  sync: () => syncBuffer,
  end: () => endBuffer,
  copyData,
  copyDone: () => copyDoneBuffer,
  copyFail,
  cancel,
}

export { serialize }
