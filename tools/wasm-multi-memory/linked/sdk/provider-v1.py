"""Define the linked-wasm32-v1 Wasm operator set independently of SDK clients."""

print('(module')
for namespace, name in [('env','memory'),('pglite','global_memory'),('pglite','scoped_memory')]:
    print(f'(import "{namespace}" "{name}" (memory ${name} 1 32768 shared))')

def operation(op, inputs, result='', immediate=''):
    params = ' '.join(f'(param {t})' for t in inputs)
    returns = f'(result {result})' if result else ''
    arguments = ' '.join(f'(local.get {i})' for i in range(len(inputs)))
    print(f'(func {params} {returns} ({op} $global_memory {immediate} {arguments}))')

for t, width in [('i32',32),('i64',64),('f32',32),('f64',64),('v128',128)]:
    operation(t+'.load', ['i32'], t)
    operation(t+'.store', ['i32',t])
    if not t.startswith('i'):
        continue
    for bits in [x for x in [8,16,32,64] if x <= width]:
        sub = str(bits) if bits < width else ''
        suffix = '_u' if sub else ''
        if sub:
            for sign in ['s','u']:
                operation(f'{t}.load{sub}_{sign}', ['i32'], t)
            operation(f'{t}.store{sub}', ['i32',t])
        operation(f'{t}.atomic.load{sub}{suffix}', ['i32'], t)
        operation(f'{t}.atomic.store{sub}', ['i32',t])
        for verb in ['add','sub','and','or','xor','xchg','cmpxchg']:
            arguments = ['i32',t,t] if verb == 'cmpxchg' else ['i32',t]
            operation(f'{t}.atomic.rmw{sub}.{verb}{suffix}', arguments, t)

for bits in [8,16,32,64]:
    operation(f'v128.load{bits}_splat', ['i32'], 'v128')
    for lane in range(128 // bits):
        operation(f'v128.load{bits}_lane', ['i32','v128'], 'v128', str(lane))
        operation(f'v128.store{bits}_lane', ['i32','v128'], '', str(lane))
for prefix in ['8x8','16x4','32x2']:
    for sign in ['s','u']:
        operation(f'v128.load{prefix}_{sign}', ['i32'], 'v128')
for bits in [32,64]:
    operation(f'v128.load{bits}_zero', ['i32'], 'v128')
    operation(f'memory.atomic.wait{bits}', ['i32',f'i{bits}','i64'], 'i32')
operation('memory.atomic.notify', ['i32','i32'], 'i32')
operation('memory.size', [], 'i32')
operation('memory.grow', ['i32'], 'i32')
operation('memory.fill', ['i32','i32','i32'])
operation('memory.copy', ['i32','i32','i32'], immediate='$global_memory')
print(')')
