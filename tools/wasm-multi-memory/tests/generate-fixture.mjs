#!/usr/bin/env node

import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const output = resolve(process.argv[2] ?? '.out/opcodes.wat')
const lines = [
  '(module',
  '  (memory $memory (import "env" "memory") 2 16 shared)',
  '  (data $blob "\\01\\02\\03\\04\\05\\06\\07\\08")',
  '  (global $side_effects (mut i32) (i32.const 0))',
  '  (func $address_with_side_effect (param $address i32) (result i32)',
  '    (global.set $side_effects (i32.add (global.get $side_effects) (i32.const 1)))',
  '    (local.get $address))',
  '  (func (export "side_effect_count") (result i32) (global.get $side_effects))',
  '  (func (export "reset_side_effect_count") (global.set $side_effects (i32.const 0)))',
]

const inventory = {}
const count = (kind) => (inventory[kind] = (inventory[kind] ?? 0) + 1)
const fn = (name, params, result, body, kind) => {
  const signature = `${params.map((type, index) => `(param $p${index} ${type})`).join(' ')}${result ? ` (result ${result})` : ''}`
  lines.push(`  (func (export "${name}") ${signature} ${body})`)
  count(kind)
}

const scalarLoads = [
  ['i32.load', 'i32'],
  ['i64.load', 'i64'],
  ['f32.load', 'f32'],
  ['f64.load', 'f64'],
  ['i32.load8_s', 'i32'],
  ['i32.load8_u', 'i32'],
  ['i32.load16_s', 'i32'],
  ['i32.load16_u', 'i32'],
  ['i64.load8_s', 'i64'],
  ['i64.load8_u', 'i64'],
  ['i64.load16_s', 'i64'],
  ['i64.load16_u', 'i64'],
  ['i64.load32_s', 'i64'],
  ['i64.load32_u', 'i64'],
]
for (const [op, result] of scalarLoads) {
  fn(
    `scalar_${op.replaceAll('.', '_')}`,
    ['i32'],
    result,
    `(${op} offset=7 align=1 (local.get $p0))`,
    'load',
  )
}

const scalarStores = [
  ['i32.store', 'i32'],
  ['i64.store', 'i64'],
  ['f32.store', 'f32'],
  ['f64.store', 'f64'],
  ['i32.store8', 'i32'],
  ['i32.store16', 'i32'],
  ['i64.store8', 'i64'],
  ['i64.store16', 'i64'],
  ['i64.store32', 'i64'],
]
for (const [op, type] of scalarStores) {
  fn(
    `scalar_${op.replaceAll('.', '_')}`,
    ['i32', type],
    '',
    `(${op} offset=7 align=1 (local.get $p0) (local.get $p1))`,
    'store',
  )
}

const atomicShapes = [
  ['i32', '', 'i32'],
  ['i64', '', 'i64'],
  ['i32', '8', 'i32'],
  ['i32', '16', 'i32'],
  ['i64', '8', 'i64'],
  ['i64', '16', 'i64'],
  ['i64', '32', 'i64'],
]
for (const [base, width, type] of atomicShapes) {
  const suffix = width ? `${width}_u` : ''
  const load = `${base}.atomic.load${suffix}`
  const store = `${base}.atomic.store${width}`
  const align = width ? Number(width) / 8 : base === 'i64' ? 8 : 4
  fn(
    `atomic_${load.replaceAll('.', '_')}`,
    ['i32'],
    type,
    `(${load} offset=${align} (local.get $p0))`,
    'atomic-load',
  )
  fn(
    `atomic_${store.replaceAll('.', '_')}`,
    ['i32', type],
    '',
    `(${store} offset=${align} (local.get $p0) (local.get $p1))`,
    'atomic-store',
  )
  for (const operation of ['add', 'sub', 'and', 'or', 'xor', 'xchg']) {
    const op = `${base}.atomic.rmw${width}.${operation}${width ? '_u' : ''}`
    fn(
      `atomic_${op.replaceAll('.', '_')}`,
      ['i32', type],
      type,
      `(${op} offset=${align} (local.get $p0) (local.get $p1))`,
      'atomic-rmw',
    )
  }
  const cmpxchg = `${base}.atomic.rmw${width}.cmpxchg${width ? '_u' : ''}`
  fn(
    `atomic_${cmpxchg.replaceAll('.', '_')}`,
    ['i32', type, type],
    type,
    `(${cmpxchg} offset=${align} (local.get $p0) (local.get $p1) (local.get $p2))`,
    'atomic-cmpxchg',
  )
}

fn(
  'atomic_wait32',
  ['i32', 'i32', 'i64'],
  'i32',
  '(memory.atomic.wait32 offset=4 (local.get $p0) (local.get $p1) (local.get $p2))',
  'atomic-wait',
)
fn(
  'atomic_wait64',
  ['i32', 'i64', 'i64'],
  'i32',
  '(memory.atomic.wait64 offset=8 (local.get $p0) (local.get $p1) (local.get $p2))',
  'atomic-wait',
)
fn(
  'atomic_notify',
  ['i32', 'i32'],
  'i32',
  '(memory.atomic.notify offset=4 (local.get $p0) (local.get $p1))',
  'atomic-notify',
)

// LLVM can fold an absolute tagged pointer into the instruction immediate.
// This is the shape used by the memory-1 System V registry in the postmaster
// build: the zero base is not a null C pointer once the immediate is applied.
fn(
  'tagged_immediate_atomic_cmpxchg',
  ['i32', 'i32'],
  'i32',
  '(i32.atomic.rmw.cmpxchg offset=2147549184 (i32.const 0) (local.get $p0) (local.get $p1))',
  'atomic-cmpxchg',
)

// LLVM also separates a positive loop/slot index from the folded tag.  The
// inline-private fast path must dispatch on the complete effective address,
// rather than treating the positive dynamic base as a private pointer.
fn(
  'tagged_immediate_positive_load',
  ['i32'],
  'i32',
  '(i32.load offset=2147549208 (local.get $p0))',
  'load',
)
fn(
  'tagged_immediate_positive_store',
  ['i32', 'i32'],
  '',
  '(i32.store offset=2147549208 (local.get $p0) (local.get $p1))',
  'store',
)
fn(
  'tagged_immediate_positive_atomic_cmpxchg',
  ['i32', 'i32', 'i32'],
  'i32',
  '(i32.atomic.rmw.cmpxchg offset=2147549184 (local.get $p0) (local.get $p1) (local.get $p2))',
  'atomic-cmpxchg',
)

const simdLoads = [
  'v128.load',
  'v128.load8x8_s',
  'v128.load8x8_u',
  'v128.load16x4_s',
  'v128.load16x4_u',
  'v128.load32x2_s',
  'v128.load32x2_u',
  'v128.load8_splat',
  'v128.load16_splat',
  'v128.load32_splat',
  'v128.load64_splat',
  'v128.load32_zero',
  'v128.load64_zero',
]
for (const op of simdLoads) {
  fn(
    `simd_${op.replaceAll('.', '_')}`,
    ['i32'],
    'i32',
    `(i32x4.extract_lane 0 (${op} offset=3 align=1 (local.get $p0)))`,
    op === 'v128.load' ? 'load' : 'simd-load',
  )
}
for (const [bits, lane] of [
  [8, 15],
  [16, 7],
  [32, 3],
  [64, 1],
]) {
  fn(
    `simd_load${bits}_lane`,
    ['i32', 'i32'],
    'i32',
    `(i32x4.extract_lane 0 (v128.load${bits}_lane offset=3 align=1 ${lane} (local.get $p0) (i32x4.splat (local.get $p1))))`,
    'simd-lane-load',
  )
  fn(
    `simd_store${bits}_lane`,
    ['i32', 'i32'],
    '',
    `(v128.store${bits}_lane offset=3 align=1 ${lane} (local.get $p0) (i32x4.splat (local.get $p1)))`,
    'simd-lane-store',
  )
}
fn(
  'simd_v128_store',
  ['i32', 'i32'],
  '',
  '(v128.store offset=3 align=1 (local.get $p0) (i32x4.splat (local.get $p1)))',
  'store',
)

fn(
  'bulk_copy',
  ['i32', 'i32', 'i32'],
  '',
  '(memory.copy (local.get $p0) (local.get $p1) (local.get $p2))',
  'memory-copy',
)
fn(
  'bulk_fill',
  ['i32', 'i32', 'i32'],
  '',
  '(memory.fill (local.get $p0) (local.get $p1) (local.get $p2))',
  'memory-fill',
)
fn(
  'bulk_init',
  ['i32', 'i32', 'i32'],
  '',
  '(memory.init $blob (local.get $p0) (local.get $p1) (local.get $p2))',
  'memory-init',
)
fn('bulk_drop', [], '', '(data.drop $blob)', 'data-drop')
fn('memory_size', [], 'i32', '(memory.size)', 'memory-size')
fn(
  'memory_grow',
  ['i32'],
  'i32',
  '(memory.grow (local.get $p0))',
  'memory-grow',
)
fn('atomic_fence', [], '', '(atomic.fence)', 'atomic-fence')

fn(
  'side_effect_load',
  ['i32'],
  'i32',
  '(i32.load (call $address_with_side_effect (local.get $p0)))',
  'load',
)
fn(
  'side_effect_store',
  ['i32', 'i32'],
  '',
  '(i32.store (call $address_with_side_effect (local.get $p0)) (local.get $p1))',
  'store',
)
fn(
  'side_effect_copy',
  ['i32', 'i32', 'i32'],
  '',
  '(memory.copy (call $address_with_side_effect (local.get $p0)) (call $address_with_side_effect (local.get $p1)) (local.get $p2))',
  'memory-copy',
)

lines.push(')')
writeFileSync(output, `${lines.join('\n')}\n`)
writeFileSync(
  `${output}.inventory.json`,
  `${JSON.stringify(inventory, null, 2)}\n`,
)
