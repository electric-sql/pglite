reset
export SDKROOT=${SDKROOT:-/opt/python-wasm-sdk}

export CI=${CI:-true}
export PGVERSION=${PGVERSION:-16.4}


export WASI=true
export contrib=false
export extra=false
export DEBUG=true
export OBJDUMP=false

rm -rf /tmp/pglite/pg.installed /tmp/pglite/bin/*.wasi build/postgres /tmp/pglite/base
echo cleaned !

export DEBUG=${DEBUG:-false}
export EXTRA_EXT=${EXTRA_EXT:-"vector postgis"}

. /opt/python-wasm-sdk/wasisdk/wasisdk_env.sh

# node linkweb pglite-prep pglite
if ./cibuild.sh ${contrib:-contrib} ${extra:-extra}
then
    echo NO WEB RUNTIME
else
    echo FAILED
fi

# WASMTIME_BACKTRACE_DETAILS=1 wasi-run /tmp/pglite/bin/postgres.wasi --single postgres
