export const Modes = {
  text: 0,
  binary: 1,
} as const

export type Mode = (typeof Modes)[keyof typeof Modes]

export type BufferParameter = ArrayBuffer | ArrayBufferView
