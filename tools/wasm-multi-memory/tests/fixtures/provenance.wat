(module
  (import "env" "memory" (memory $memory 2 16 shared))
  (import "env" "__stack_pointer" (global $stack (mut i32)))
  (import "GOT.mem" "private_slot" (global $slot (mut i32)))

  (func $palloc (export "palloc") (param $address i32) (result i32)
    (local.get $address)
  )

  (func $private_identity (export "pgl_private_pointer")
    (param $address i32) (result i32)
    (local.get $address)
  )

  (func $internal (param $address i32) (result i32)
    (i32.load (local.get $address))
  )

  (func (export "constant") (result i32)
    (i32.load (i32.const 96))
  )

  ;; Constant and constant-offset tagged roots prove that the operation can
  ;; name memory 1 or 2 directly without a runtime domain branch.
  (func (export "constant_global") (result i32)
    (i32.load (i32.const -2147483488))
  )

  (func (export "constant_scoped") (result i32)
    (i32.load
      (i32.add (i32.const -1073741668) (i32.const 4))
    )
  )

  (func (export "stack") (result i32)
    (i32.load
      (i32.sub (global.get $stack) (i32.const 8))
    )
  )

  (func (export "got") (result i32)
    (i32.load (global.get $slot))
  )

  (func (export "allocator_and_internal") (result i32)
    (call $internal
      (call $palloc (i32.const 128))
    )
  )

  (func (export "unknown") (param $address i32) (result i32)
    (i32.load (local.get $address))
  )

  (func (export "marked") (param $address i32) (result i32)
    (i32.load (call $private_identity (local.get $address)))
  )

  (func $marked_parameter (export "marked_parameter")
    (param $address i32) (result i32)
    (local.set $address
      (call $private_identity (local.get $address))
    )
    (i32.load (local.get $address))
  )

  ;; A conditional marker must not classify the parameter for the whole body.
  (func (export "conditional_marked")
    (param $address i32) (param $mark i32) (result i32)
    (if (local.get $mark)
      (then
        (local.set $address
          (call $private_identity (local.get $address))
        )
      )
    )
    (i32.load (local.get $address))
  )

  ;; A value branch and the fallthrough are both incoming values for the
  ;; block. The branch loads a tagged global pointer from a private container;
  ;; the fallthrough is certainly private. The outer load must therefore stay
  ;; dynamically routed.
  (func (export "block_address_join")
    (param $container i32) (param $choose_global i32) (result i32)
    (local.set $container
      (call $private_identity (local.get $container))
    )
    (i32.load
      (block $address (result i32)
        (if (local.get $choose_global)
          (then
            (br $address
              (i32.load (local.get $container))
            )
          )
        )
        (i32.add (local.get $container) (i32.const 4))
      )
    )
  )

  (func (export "loop") (param $address i32) (param $count i32) (result i32)
    (local $sum i32)
    (block $done
      (loop $next
        (br_if $done (i32.eqz (local.get $count)))
        (local.set $sum
          (i32.add
            (local.get $sum)
            (i32.load (local.get $address))
          )
        )
        (local.set $address
          (i32.add (local.get $address) (i32.const 4))
        )
        (local.set $count
          (i32.sub (local.get $count) (i32.const 1))
        )
        (br $next)
      )
    )
    (local.get $sum)
  )

  ;; Reassigning an unknown pointer in a loop can leave a LocalGraph query
  ;; with only a closed reaching-definition cycle. The cycle is not a private
  ;; provenance root: this must still route a tagged global pointer.
  (func (export "unrooted_pointer_cycle")
    (param $address i32) (param $count i32) (result i32)
    (loop $next
      (local.set $address
        (i32.add (local.get $address) (i32.const 4))
      )
      (br_if $next
        (local.tee $count
          (i32.sub (local.get $count) (i32.const 1))
        )
      )
    )
    (i32.load (local.get $address))
  )
)
