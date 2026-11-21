import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const memory = new WebAssembly.Memory({ initial: 1 })
const floats = new Float32Array(memory.buffer)
for (let i = 0; i < floats.length; i++) floats[i] = i + 0.5

function load(path) {
  const module = new WebAssembly.Module(readFileSync(path))
  const calls = []
  const { sum } = new WebAssembly.Instance(module, {
    env: {
      memory,
      slow: (address) => {
        calls.push(address)
        return 100
      },
    },
    pglite: { global_memory: memory, scoped_memory: memory },
  }).exports
  return (args) => {
    calls.length = 0
    try {
      return { result: sum(...args), calls: [...calls] }
    } catch (error) {
      assert.ok(error instanceof WebAssembly.RuntimeError)
      return { trap: error.message, calls: [...calls] }
    }
  }
}
const [original, versioned] = process.argv.slice(2).map(load)
for (const args of [
  [8, 0, 0, 6], // private fast path
  [65528, 0, 0, 2], // last valid float
  [65532, 0, 0, 2], // address is private, but the load must trap
  [0, 0, 0, 4], // null followed by private
  [0x80000004, 0, 0, 8], // tagged shared addresses
  [0xfffffff8, 0, 0, 6], // wraps through zero to private
  [0x7ffffffc, 0, 0, 4], // range crosses the private aperture
  [8, 1, 3, 7], // nonzero counters and an odd end
  [8, 0x40000000, 0, 4], // index multiplication wraps
  [8, 0, 0xfffffffe, 0], // latch wraps to zero on the first iteration
  [8, 0, 0, 1], // unreachable odd end, traps partway through
])
  assert.deepEqual(versioned(args), original(args), String(args))

console.log(
  'Private-range guards preserve values, address side effects, fallback calls and traps.',
)
