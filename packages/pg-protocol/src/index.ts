import { DatabaseError } from './messages'
import { serialize } from './serializer'
import { Parser, MessageCallback } from './parser'

export function parse(
  stream: NodeJS.ReadableStream,
  callback: MessageCallback,
): Promise<void> {
  const parser = new Parser()
  stream.on('data', (bufferView: ArrayBufferView) =>
    parser.parse(bufferView.buffer, callback),
  )
  return new Promise((resolve) => stream.on('end', () => resolve()))
}

export { serialize, DatabaseError }
