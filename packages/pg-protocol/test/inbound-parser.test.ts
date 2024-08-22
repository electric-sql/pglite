import { describe, it, expect } from 'vitest'
import buffers from './testing/test-buffers'
import BufferList from './testing/buffer-list'
import { parse } from '../src'
import assert from 'assert'
import { PassThrough } from 'stream'
import {
  AuthenticationMessage,
  BackendKeyDataMessage,
  BackendMessage,
  CommandCompleteMessage,
  DataRowMessage,
  Modes,
  NotificationResponseMessage,
  ParameterDescriptionMessage,
  ParameterStatusMessage,
  ReadyForQueryMessage,
  RowDescriptionMessage,
} from '../src/messages'

const authOkBuffer = buffers.authenticationOk()
const paramStatusBuffer = buffers.parameterStatus('client_encoding', 'UTF8')
const readyForQueryBuffer = buffers.readyForQuery()
const backendKeyDataBuffer = buffers.backendKeyData(1, 2)
const commandCompleteBuffer = buffers.commandComplete('SELECT 3')
const parseCompleteBuffer = buffers.parseComplete()
const bindCompleteBuffer = buffers.bindComplete()
const portalSuspendedBuffer = buffers.portalSuspended()

const row1 = {
  name: 'id',
  tableID: 1,
  columnID: 2,
  dataTypeID: 3,
  dataTypeSize: 4,
  dataTypeModifier: 5,
  format: Modes.text,
}
const oneRowDescBuff = buffers.rowDescription([row1])
row1.name = 'bang'

const twoRowBuf = buffers.rowDescription([
  row1,
  {
    name: 'whoah',
    tableID: 10,
    columnID: 11,
    dataTypeID: 12,
    dataTypeSize: 13,
    dataTypeModifier: 14,
    format: Modes.text,
  },
])

const emptyRowFieldBuf = buffers.dataRow([])

const oneFieldBuf = buffers.dataRow(['test'])

const expectedAuthenticationOkayMessage: BackendMessage = {
  name: 'authenticationOk',
  length: 8,
}

const expectedParameterStatusMessage: ParameterStatusMessage = {
  name: 'parameterStatus',
  parameterName: 'client_encoding',
  parameterValue: 'UTF8',
  length: 25,
}

const expectedBackendKeyDataMessage: BackendKeyDataMessage = {
  name: 'backendKeyData',
  processID: 1,
  secretKey: 2,
  length: 12,
}

const expectedReadyForQueryMessage: ReadyForQueryMessage = {
  name: 'readyForQuery',
  length: 5,
  status: 'I',
}

const expectedCommandCompleteMessage: CommandCompleteMessage = {
  name: 'commandComplete',
  length: 13,
  text: 'SELECT 3',
}
const emptyRowDescriptionBuffer = new BufferList()
  .addInt16(0) // number of fields
  .join(true, 'T')

const expectedEmptyRowDescriptionMessage: RowDescriptionMessage = {
  name: 'rowDescription',
  length: 6,
  fieldCount: 0,
  fields: [],
}
const expectedOneRowMessage: RowDescriptionMessage = {
  name: 'rowDescription',
  length: 27,
  fieldCount: 1,
  fields: [
    {
      name: 'id',
      tableID: 1,
      columnID: 2,
      dataTypeID: 3,
      dataTypeSize: 4,
      dataTypeModifier: 5,
      format: Modes.text,
    },
  ],
}

const expectedTwoRowMessage: RowDescriptionMessage = {
  name: 'rowDescription',
  length: 53,
  fieldCount: 2,
  fields: [
    {
      name: 'bang',
      tableID: 1,
      columnID: 2,
      dataTypeID: 3,
      dataTypeSize: 4,
      dataTypeModifier: 5,
      format: Modes.text,
    },
    {
      name: 'whoah',
      tableID: 10,
      columnID: 11,
      dataTypeID: 12,
      dataTypeSize: 13,
      dataTypeModifier: 14,
      format: Modes.text,
    },
  ],
}

const emptyParameterDescriptionBuffer = new BufferList()
  .addInt16(0) // number of parameters
  .join(true, 't')

const oneParameterDescBuf = buffers.parameterDescription([1111])

const twoParameterDescBuf = buffers.parameterDescription([2222, 3333])

const expectedEmptyParameterDescriptionMessage: ParameterDescriptionMessage = {
  name: 'parameterDescription',
  length: 6,
  parameterCount: 0,
  dataTypeIDs: [],
}

const expectedOneParameterMessage: ParameterDescriptionMessage = {
  name: 'parameterDescription',
  length: 10,
  parameterCount: 1,
  dataTypeIDs: [1111],
}

const expectedTwoParameterMessage: ParameterDescriptionMessage = {
  name: 'parameterDescription',
  length: 14,
  parameterCount: 2,
  dataTypeIDs: [2222, 3333],
}

function testForMessage<T extends BackendMessage>(
  buffer: ArrayBuffer,
  expectedMessage: T,
) {
  it('recieves and parses ' + expectedMessage.name, async () => {
    const messages = await parseBuffers([buffer])
    const [lastMessage] = messages

    for (const key in expectedMessage) {
      expect((lastMessage as Record<string, unknown>)[key]).toEqual(
        expectedMessage[key],
      )
    }
  })
}

const plainPasswordBuffer = buffers.authenticationCleartextPassword()
const md5PasswordBuffer = buffers.authenticationMD5Password()
const SASLBuffer = buffers.authenticationSASL()
const SASLContinueBuffer = buffers.authenticationSASLContinue()
const SASLFinalBuffer = buffers.authenticationSASLFinal()

const expectedPlainPasswordMessage: AuthenticationMessage = {
  name: 'authenticationCleartextPassword',
  length: 8,
}

const expectedMD5PasswordMessage: AuthenticationMessage = {
  name: 'authenticationMD5Password',
  length: 12,
  salt: new Uint8Array([1, 2, 3, 4]).buffer,
}

const expectedSASLMessage: AuthenticationMessage = {
  name: 'authenticationSASL',
  length: SASLBuffer.byteLength - 1,
  mechanisms: ['SCRAM-SHA-256'],
}

const expectedSASLContinueMessage: AuthenticationMessage = {
  name: 'authenticationSASLContinue',
  length: SASLContinueBuffer.byteLength - 1,
  data: 'data',
}

const expectedSASLFinalMessage: AuthenticationMessage = {
  name: 'authenticationSASLFinal',
  length: SASLFinalBuffer.byteLength - 1,
  data: 'data',
}

const notificationResponseBuffer = buffers.notification(4, 'hi', 'boom')
const expectedNotificationResponseMessage: NotificationResponseMessage = {
  name: 'notification',
  processId: 4,
  channel: 'hi',
  payload: 'boom',
  length: notificationResponseBuffer.byteLength - 1,
}

const parseBuffers = async (
  buffers: ArrayBuffer[],
): Promise<BackendMessage[]> => {
  const stream = new PassThrough()
  for (const buffer of buffers) {
    stream.write(new Uint8Array(buffer))
  }
  stream.end()
  const msgs: BackendMessage[] = []
  await parse(stream, (msg) => msgs.push(msg))
  return msgs
}

function concatBuffers(buffers: ArrayBuffer[]): ArrayBuffer {
  let length = 0
  for (const b of buffers) length += b.byteLength

  const buf = new Uint8Array(length)
  let offset = 0
  for (const b of buffers) {
    const uint8view = new Uint8Array(b)
    buf.set(uint8view, offset)
    offset += uint8view.byteLength
  }

  return buf.buffer
}

describe('PgPacketStream', function () {
  testForMessage(authOkBuffer, expectedAuthenticationOkayMessage)
  testForMessage(plainPasswordBuffer, expectedPlainPasswordMessage)
  testForMessage(md5PasswordBuffer, expectedMD5PasswordMessage)
  testForMessage(SASLBuffer, expectedSASLMessage)
  testForMessage(SASLContinueBuffer, expectedSASLContinueMessage)

  // this exercises a found bug in the parser:
  // https://github.com/brianc/node-postgres/pull/2210#issuecomment-627626084
  // and adds a test which is deterministic, rather than relying on network packet chunking
  const extendedSASLContinueBuffer = concatBuffers([
    SASLContinueBuffer,
    new Uint8Array([1, 2, 3, 4]).buffer,
  ])
  testForMessage(extendedSASLContinueBuffer, expectedSASLContinueMessage)

  testForMessage(SASLFinalBuffer, expectedSASLFinalMessage)

  // this exercises a found bug in the parser:
  // https://github.com/brianc/node-postgres/pull/2210#issuecomment-627626084
  // and adds a test which is deterministic, rather than relying on network packet chunking
  const extendedSASLFinalBuffer = concatBuffers([
    SASLFinalBuffer,
    new Uint8Array([1, 2, 4, 5]).buffer,
  ])
  testForMessage(extendedSASLFinalBuffer, expectedSASLFinalMessage)

  testForMessage(paramStatusBuffer, expectedParameterStatusMessage)
  testForMessage(backendKeyDataBuffer, expectedBackendKeyDataMessage)
  testForMessage(readyForQueryBuffer, expectedReadyForQueryMessage)
  testForMessage(commandCompleteBuffer, expectedCommandCompleteMessage)
  testForMessage(
    notificationResponseBuffer,
    expectedNotificationResponseMessage,
  )
  testForMessage(buffers.emptyQuery(), {
    name: 'emptyQuery',
    length: 4,
  })

  testForMessage(new Uint8Array([0x6e, 0, 0, 0, 4]).buffer, {
    name: 'noData',
    length: 5,
  })

  describe('rowDescription messages', function () {
    testForMessage(
      emptyRowDescriptionBuffer,
      expectedEmptyRowDescriptionMessage,
    )
    testForMessage(oneRowDescBuff, expectedOneRowMessage)
    testForMessage(twoRowBuf, expectedTwoRowMessage)
  })

  describe('parameterDescription messages', function () {
    testForMessage(
      emptyParameterDescriptionBuffer,
      expectedEmptyParameterDescriptionMessage,
    )
    testForMessage(oneParameterDescBuf, expectedOneParameterMessage)
    testForMessage(twoParameterDescBuf, expectedTwoParameterMessage)
  })

  describe('parsing rows', function () {
    describe('parsing empty row', function () {
      testForMessage(emptyRowFieldBuf, {
        name: 'dataRow',
        fieldCount: 0,
        length: emptyRowFieldBuf.byteLength - 1,
      })
    })

    describe('parsing data row with fields', function () {
      testForMessage(oneFieldBuf, {
        name: 'dataRow',
        fieldCount: 1,
        fields: ['test'],
        length: oneFieldBuf.byteLength - 1,
      })
    })
  })

  describe('notice message', function () {
    // this uses the same logic as error message
    const buff = buffers.notice([{ type: 'C', value: 'code' }])
    testForMessage(buff, {
      name: 'notice',
      code: 'code',
      length: buff.byteLength - 1,
    })
  })

  testForMessage(buffers.error([]), {
    name: 'error',
    length: buffers.error([]).byteLength - 1,
  })

  describe('with all the fields', function () {
    const buffer = buffers.error([
      {
        type: 'S',
        value: 'ERROR',
      },
      {
        type: 'C',
        value: 'code',
      },
      {
        type: 'M',
        value: 'message',
      },
      {
        type: 'D',
        value: 'details',
      },
      {
        type: 'H',
        value: 'hint',
      },
      {
        type: 'P',
        value: '100',
      },
      {
        type: 'p',
        value: '101',
      },
      {
        type: 'q',
        value: 'query',
      },
      {
        type: 'W',
        value: 'where',
      },
      {
        type: 'F',
        value: 'file',
      },
      {
        type: 'L',
        value: 'line',
      },
      {
        type: 'R',
        value: 'routine',
      },
      {
        type: 'Z', // ignored
        value: 'alsdkf',
      },
    ])

    testForMessage(buffer, {
      name: 'error',
      severity: 'ERROR',
      code: 'code',
      message: 'message',
      detail: 'details',
      hint: 'hint',
      position: '100',
      internalPosition: '101',
      internalQuery: 'query',
      where: 'where',
      file: 'file',
      line: 'line',
      routine: 'routine',
      length: buffer.byteLength - 1,
    })
  })

  testForMessage(parseCompleteBuffer, {
    name: 'parseComplete',
    length: 5,
  })

  testForMessage(bindCompleteBuffer, {
    name: 'bindComplete',
    length: 5,
  })

  testForMessage(buffers.closeComplete(), {
    name: 'closeComplete',
    length: 5,
  })

  describe('parses portal suspended message', function () {
    testForMessage(portalSuspendedBuffer, {
      name: 'portalSuspended',
      length: 5,
    })
  })

  describe('parses replication start message', function () {
    testForMessage(new Uint8Array([0x57, 0x00, 0x00, 0x00, 0x04]).buffer, {
      name: 'replicationStart',
      length: 4,
    })
  })

  describe('copy', () => {
    testForMessage(buffers.copyIn(0), {
      name: 'copyInResponse',
      length: 7,
      binary: false,
      columnTypes: [],
    })

    testForMessage(buffers.copyIn(2), {
      name: 'copyInResponse',
      length: 11,
      binary: false,
      columnTypes: [0, 1],
    })

    testForMessage(buffers.copyOut(0), {
      name: 'copyOutResponse',
      length: 7,
      binary: false,
      columnTypes: [],
    })

    testForMessage(buffers.copyOut(3), {
      name: 'copyOutResponse',
      length: 13,
      binary: false,
      columnTypes: [0, 1, 2],
    })

    testForMessage(buffers.copyDone(), {
      name: 'copyDone',
      length: 4,
    })

    testForMessage(buffers.copyData(new Uint8Array([5, 6, 7]).buffer), {
      name: 'copyData',
      length: 7,
      chunk: new Uint8Array([5, 6, 7]).buffer,
    })
  })

  // since the data message on a stream can randomly divide the incomming
  // tcp packets anywhere, we need to make sure we can parse every single
  // split on a tcp message
  describe('split buffer, single message parsing', function () {
    const fullBuffer = buffers.dataRow([null, 'bang', 'zug zug', null, '!'])

    it('parses when full buffer comes in', async function () {
      const messages = await parseBuffers([fullBuffer])
      const message = messages[0] as DataRowMessage
      assert.equal(message.fields.length, 5)
      assert.equal(message.fields[0], null)
      assert.equal(message.fields[1], 'bang')
      assert.equal(message.fields[2], 'zug zug')
      assert.equal(message.fields[3], null)
      assert.equal(message.fields[4], '!')
    })

    const testMessageRecievedAfterSpiltAt = async function (split: number) {
      const firstBufferView = new Uint8Array(fullBuffer.byteLength - split)
      const secondBufferView = new Uint8Array(
        fullBuffer.byteLength - firstBufferView.byteLength,
      )

      firstBufferView.set(
        new Uint8Array(fullBuffer, 0, firstBufferView.byteLength),
      )
      secondBufferView.set(
        new Uint8Array(fullBuffer, firstBufferView.byteLength),
      )

      const messages = await parseBuffers([fullBuffer])
      const message = messages[0] as DataRowMessage
      assert.equal(message.fields.length, 5)
      assert.equal(message.fields[0], null)
      assert.equal(message.fields[1], 'bang')
      assert.equal(message.fields[2], 'zug zug')
      assert.equal(message.fields[3], null)
      assert.equal(message.fields[4], '!')
    }

    it('parses when split in the middle', function () {
      testMessageRecievedAfterSpiltAt(6)
    })

    it('parses when split at end', function () {
      testMessageRecievedAfterSpiltAt(2)
    })

    it('parses when split at beginning', function () {
      testMessageRecievedAfterSpiltAt(fullBuffer.byteLength - 2)
      testMessageRecievedAfterSpiltAt(fullBuffer.byteLength - 1)
      testMessageRecievedAfterSpiltAt(fullBuffer.byteLength - 5)
    })
  })

  describe('split buffer, multiple message parsing', function () {
    const dataRowBuffer = buffers.dataRow(['!'])
    const readyForQueryBuffer = buffers.readyForQuery()
    const fullBuffer = new ArrayBuffer(
      dataRowBuffer.byteLength + readyForQueryBuffer.byteLength,
    )
    const fullBufferView = new Uint8Array(fullBuffer)
    fullBufferView.set(new Uint8Array(dataRowBuffer))
    fullBufferView.set(
      new Uint8Array(readyForQueryBuffer),
      dataRowBuffer.byteLength,
    )

    function verifyMessages(messages: BackendMessage[]) {
      expect(messages).toHaveLength(2)
      expect(messages[0]).toEqual({
        name: 'dataRow',
        fieldCount: 1,
        length: 11,
        fields: ['!'],
      })
      expect((messages[0] as DataRowMessage).fields[0]).toBe('!')
      expect(messages[1]).toEqual({
        name: 'readyForQuery',
        length: 5,
        status: 'I',
      })
    }
    // sanity check
    it('recieves both messages when packet is not split', async function () {
      const messages = await parseBuffers([fullBuffer])
      verifyMessages(messages)
    })

    const splitAndVerifyTwoMessages = async function (split: number) {
      const firstBufferView = new Uint8Array(fullBuffer.byteLength - split)
      const secondBufferView = new Uint8Array(
        fullBuffer.byteLength - firstBufferView.byteLength,
      )
      firstBufferView.set(
        new Uint8Array(fullBuffer, 0, firstBufferView.byteLength),
      )
      secondBufferView.set(
        new Uint8Array(fullBuffer, firstBufferView.byteLength),
      )

      const messages = await parseBuffers([
        firstBufferView.buffer,
        secondBufferView.buffer,
      ])
      verifyMessages(messages)
    }

    describe('recieves both messages when packet is split', function () {
      it('in the middle', function () {
        return splitAndVerifyTwoMessages(11)
      })
      it('at the front', function () {
        return Promise.all([
          splitAndVerifyTwoMessages(fullBuffer.byteLength - 1),
          splitAndVerifyTwoMessages(fullBuffer.byteLength - 4),
          splitAndVerifyTwoMessages(fullBuffer.byteLength - 6),
        ])
      })

      it('at the end', function () {
        return Promise.all([
          splitAndVerifyTwoMessages(8),
          splitAndVerifyTwoMessages(1),
        ])
      })
    })
  })
})
