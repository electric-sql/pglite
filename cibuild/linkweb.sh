#!/bin/bash
echo "============= link web : begin ==============="

WEBROOT=${WEBROOT:-/tmp/sdk}
echo "



linkweb:begin

    $(pwd)

    WEBROOT=${WEBROOT}

    CC_PGLITE=$CC_PGLITE

"

mkdir -p $WEBROOT

NOWARN="-Wno-missing-prototypes -Wno-unused-function -Wno-declaration-after-statement -Wno-incompatible-pointer-types-discards-qualifiers"

# client lib ( eg psycopg ) for websocketed pg server
emcc $CDEBUG -shared -o ${WEBROOT}/libpgc.so \
     ./src/interfaces/libpq/libpq.a \
     ./src/port/libpgport.a \
     ./src/common/libpgcommon.a || exit 26

# this override completely pg server main loop for web use purpose
pushd src
    rm pg_initdb.o backend/main/main.o ./backend/tcop/postgres.o ./backend/utils/init/postinit.o

    emcc -DPG_INITDB_MAIN=1 -sFORCE_FILESYSTEM -DPREFIX=${PGROOT} ${CC_PGLITE} \
     -I${PGROOT}/include -I${PGROOT}/include/postgresql/server -I${PGROOT}/include/postgresql/internal \
     -c -o ../pg_initdb.o ${PGSRC}/src/bin/initdb/initdb.c $NOWARN || exit 34

    #
    emcc -DPG_LINK_MAIN=1 -DPREFIX=${PGROOT} ${CC_PGLITE} -DPG_EC_STATIC \
     -I${PGROOT}/include -I${PGROOT}/include/postgresql/server -I${PGROOT}/include/postgresql/internal \
     -c -o ./backend/tcop/postgres.o ${PGSRC}/src/backend/tcop/postgres.c $NOWARN|| exit 39

    EMCC_CFLAGS="${CC_PGLITE} -DPREFIX=${PGROOT} -DPG_INITDB_MAIN=1 $NOWARN" \
     emmake make backend/main/main.o backend/utils/init/postinit.o || exit 41
popd


echo "========================================================"
echo -DPREFIX=${PGROOT} $CC_PGLITE
file ${WEBROOT}/libpgc.so pg_initdb.o src/backend/main/main.o src/backend/tcop/postgres.o src/backend/utils/init/postinit.o
echo "========================================================"


pushd src/backend

    # https://github.com/emscripten-core/emscripten/issues/12167
    # --localize-hidden
    # https://github.com/llvm/llvm-project/issues/50623


    echo " ---------- building web test PREFIX=$PGROOT ------------"
    du -hs ${WEBROOT}/libpg?.*

    PG_O="../../src/fe_utils/string_utils.o ../../src/common/logging.o \
     $(find . -type f -name "*.o" \
     | grep -v ./utils/mb/conversion_procs \
     | grep -v ./replication/pgoutput \
     | grep -v  src/bin/ \
     | grep -v ./snowball/dict_snowball.o ) \
     ../../src/timezone/localtime.o \
     ../../src/timezone/pgtz.o \
     ../../src/timezone/strftime.o \
     ../../pg_initdb.o"

    PG_L="../../src/common/libpgcommon_srv.a ../../src/port/libpgport_srv.a ../.././src/interfaces/libpq/libpq.a -L$PREFIX/lib -lxml2 -sUSE_ZLIB"

    if $DEBUG
    then
        echo -n
    fi

    export PG_L


# ? -sLZ4=1  -sENVIRONMENT=web
# -sSINGLE_FILE  => Uncaught SyntaxError: Cannot use 'import.meta' outside a module (at postgres.html:1:6033)
# -sENVIRONMENT=web => XHR

    export EMCC_WEB="-sNO_EXIT_RUNTIME=1 -sFORCE_FILESYSTEM=1"

    if ${PGES6:-true}
    then
        # es6
        MODULE="-g3 -O0 -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=Module" #OK
        MODULE="-g0 -Os -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=Module" # no plpgsql 7.2M
        MODULE="-g0 -O2 -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=Module" #OK 7.4M
        #MODULE="-g0 -O3 -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=Module" # NO
        # MODULE="-g0 -Os -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=Module" # NO  08-23 3.1.65
        MODULE="-g0 -O2 --closure 0 -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=Module"

    else
        # local debug fast build
        MODULE="-g3 -O0 -sMODULARIZE=0 -sEXPORT_ES6=0"
    fi

    MODULE="$MODULE  --shell-file ${WORKSPACE}/tests/repl.html"
    # closure -sSIMPLE_OPTIMIZATION ?

    # =======================================================
    # size optimisations
    # =======================================================

    rm ${PGROOT}/lib/lib*.so.? 2>/dev/null

    echo "#!/bin/true" > placeholder
    chmod +x placeholder

    # for ./bin

    # share/postgresql/pg_hba.conf.sample REQUIRED
    # rm ${PGROOT}/share/postgresql/*.sample

    # ./lib/lib*.a => ignored

    # ./include ignored

    # timezones ?

    # encodings ?
    # ./lib/postgresql/utf8_and*.so
    rm ${PGROOT}/lib/postgresql/utf8_and*.so


    # =========================================================

    # --js-library
    # cp ${WORKSPACE}/patches/library_pgfs.js ${EMSDK}/upstream/emscripten/src/library_pgfs.js

    python3 > ${PGROOT}/PGPASSFILE <<END
USER="${PGPASS:-postgres}"
PASS="${PGUSER:-postgres}"
md5pass =  "md5" + __import__('hashlib').md5(USER.encode() + PASS.encode()).hexdigest()
print(f"localhost:5432:postgres:{USER}:{md5pass}")
USER="login"
PASS="password"
md5pass =  "md5" + __import__('hashlib').md5(USER.encode() + PASS.encode()).hexdigest()
print(f"localhost:5432:postgres:{USER}:{md5pass}")
END

    if $OBJDUMP
    then
    echo "

    Linking to : $PG_L


"

        # link with MAIN_MODULE=1 ( ie export all ) and extract all sym.
        . ${WORKSPACE}/cibuild/linkexport.sh || exit 158

        if [ -f ${WORKSPACE}/patches/exports/pgcore ]
        then
            echo "PGLite can export $(wc -l ${WORKSPACE}/patches/exports/pgcore) core symbols"
            . ${WORKSPACE}/cibuild/linkimports.sh || exit 163

        else
            echo "

    _________________________________________________________
        WARNING: using cached/provided imported symbol list
    _________________________________________________________


    "
        fi

    else
        echo "

_________________________________________________________
    WARNING: using cached/provided exported symbol list
_________________________________________________________


"
    fi


    cat ${WORKSPACE}/patches/exports/pglite > exports

    # min
    # LINKER="-sMAIN_MODULE=2"

    # tailored
    LINKER="-sMAIN_MODULE=2 -sEXPORTED_FUNCTIONS=@exports"

    # FULL
    # LINKER="-sMAIN_MODULE=1 -sEXPORTED_FUNCTIONS=@exports"


    emcc $EMCC_WEB $LINKER $MODULE  \
     -sTOTAL_MEMORY=${TOTAL_MEMORY} -sSTACK_SIZE=4MB -sGLOBAL_BASE=${CMA_MB}MB \
     -fPIC -D__PYDK__=1 -DPREFIX=${PGROOT} \
     -sALLOW_TABLE_GROWTH -sALLOW_MEMORY_GROWTH -sERROR_ON_UNDEFINED_SYMBOLS -sASSERTIONS=0 \
     -lnodefs.js -lidbfs.js \
     -sEXPORTED_RUNTIME_METHODS=FS,setValue,getValue,UTF8ToString,stringToNewUTF8,stringToUTF8OnStack,ccall,cwrap,callMain \
     $PGPRELOAD \
     -o postgres.html $PG_O $PG_L || exit 200

    cp postgres.js /tmp/

    echo "TAILORED:" >> ${WORKSPACE}/build/sizes.log
    du -hs postgres.wasm >> ${WORKSPACE}/build/sizes.log
    echo >> ${WORKSPACE}/build/sizes.log


    mkdir -p ${WEBROOT}

    cp -v postgres.* ${WEBROOT}/
    #cp ${PGROOT}/lib/libecpg.so ${WEBROOT}/
    cp ${PGROOT}/sdk/*.tar ${WEBROOT}/
    for tarf in ${WEBROOT}/*.tar
    do
        gzip -f -9 $tarf
    done


    cp $WORKSPACE/{tests/vtx.js,patches/tinytar.min.js} ${WEBROOT}/

popd


echo "
============= link web : end ===============



"




