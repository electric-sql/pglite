(module
  (memory $memory 1 2)
  (func (export "load") (param i32) (result i32)
    (i32.load (local.get 0)))
)
