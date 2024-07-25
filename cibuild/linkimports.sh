echo "============= link imports : begin ==============="
    # _main,_getenv,_setenv,_interactive_one,_interactive_write,_interactive_read,_pg_initdb,_pg_shutdown

#not yet

#_emscripten_copy_from
#_emscripten_copy_to
#_emscripten_copy_to_end

# copyFrom,copyTo,copyToEnd
    cat $PGROOT/imports.* | sort | uniq > /tmp/symbols

    echo "Requesting $(wc -l /tmp/symbols) symbols from PGlite"

    python3 <<END > ${WORKSPACE}/patches/exports

import sys
import os

def dbg(*argv, **kw):
    kw.setdefault('file',sys.stderr)
    return print(*argv,**kw)

with open("${WORKSPACE}/patches/exports.pglite", "r") as file:
    exports  = set(map(str.strip, file.readlines()))

with open("/tmp/symbols", "r") as file:
    imports  = set(map(str.strip, file.readlines()))

matches = list( imports.intersection(exports) )
for sym in matches:
    print(sym)

# ?
for sym in """___cxa_throw
_main
_main_repl
_pg_repl_raf
_getenv
_setenv
_interactive_one
_interactive_write
_interactive_read
_pg_initdb
_pg_shutdown
_lowerstr
_shmem_request_hook
_TopMemoryContext
_check_function_bodies
_clock_gettime
_setenv""".split("\n"):
    if not sym in matches:
        print(sym)

dbg(f"""
exports {len(exports)}
imports {len(imports)}
Matches : {len(matches)}
""")
END

echo "============= link imports : end ==============="
