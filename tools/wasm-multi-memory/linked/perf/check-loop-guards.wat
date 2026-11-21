(module
  (import "env" "memory" (memory 1))
  (import "pglite" "global_memory" (memory 1))
  (import "pglite" "scoped_memory" (memory 1))
  (import "env" "slow" (func $slow (param i32) (result f32)))

  ;; Two counters let the test enter the same loop at arbitrary starting values.
  (func (export "sum") (param $base i32) (param $index i32)
    (param $count i32) (param $end i32) (result f32 i32)
    (local $address i32) (local $sum f32)
    (loop $again
      (local.set $sum
        (f32.add (local.get $sum)
          (if (result f32)
            (i32.gt_s
              (local.tee $address
                (i32.add (local.get $base)
                  (i32.shl (local.get $index) (i32.const 2))))
              (i32.const 0))
            (then (f32.load offset=4 (local.get $address)))
            (else (call $slow (local.get $address))))))
      (local.set $index (i32.add (local.get $index) (i32.const 2)))
      (br_if $again
        (i32.ne (local.tee $count (i32.add (local.get $count) (i32.const 2)))
          (local.get $end))))
    (local.get $sum)
    (local.get $address)))
