#!/bin/bash

echo "



linkweb:begin

CC_PGLITE=$CC_PGLITE

"

WEBROOT=${WEBROOT:-/tmp/sdk}
mkdir -p $WEBROOT

# client lib ( eg psycopg ) for websocketed pg server
emcc $CDEBUG -shared -o ${WEBROOT}/libpgc.so \
     ./src/interfaces/libpq/libpq.a \
     ./src/port/libpgport.a \
     ./src/common/libpgcommon.a || exit 20

# this override completely pg server main loop for web use purpose
pushd src
    rm pg_initdb.o backend/main/main.o ./backend/tcop/postgres.o ./backend/utils/init/postinit.o

    emcc -DPG_INITDB_MAIN=1 -sFORCE_FILESYSTEM -DPREFIX=${PGROOT} ${CC_PGLITE} \
     -I${PGROOT}/include -I${PGROOT}/include/postgresql/server -I${PGROOT}/include/postgresql/internal \
     -c -o ../pg_initdb.o ${PGSRC}/src/bin/initdb/initdb.c || exit 28

    #
    emcc -DPG_LINK_MAIN=1 -DPREFIX=${PGROOT} ${CC_PGLITE} \
     -I${PGROOT}/include -I${PGROOT}/include/postgresql/server -I${PGROOT}/include/postgresql/internal \
     -c -o ./backend/tcop/postgres.o ${PGSRC}/src/backend/tcop/postgres.c || exit 33

    EMCC_CFLAGS="${CC_PGLITE} -DPREFIX=${PGROOT} -DPG_INITDB_MAIN=1" emmake make backend/main/main.o backend/utils/init/postinit.o || exit 35
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

PG_L="-L../../src/port -L../../src/common \
 ../../src/common/libpgcommon_srv.a ../../src/port/libpgport_srv.a"

if [ -f /tmp/pglite/lib/postgresql/libduckdb.so ]
then
    PG_L="$PG_L -L../../src/interfaces/ecpg/ecpglib ../../src/interfaces/ecpg/ecpglib/libecpg.so /tmp/pglite/lib/postgresql/libduckdb.so"
else
    PG_L="$PG_L -L../../src/interfaces/ecpg/ecpglib ../../src/interfaces/ecpg/ecpglib/libecpg.so"
fi


## \
# /opt/python-wasm-sdk/devices/emsdk/usr/lib/libxml2.a \
# /opt/python-wasm-sdk/devices/emsdk/usr/lib/libgeos.a \
# /opt/python-wasm-sdk/devices/emsdk/usr/lib/libgeos_c.a \
# /opt/python-wasm-sdk/devices/emsdk/usr/lib/libproj.a"

# /data/git/pglite-build/pglite/postgres/libgeosall.so
# /data/git/pglite-build/pglite/postgres/libduckdb.so"


# ? -sLZ4=1  -sENVIRONMENT=web
# -sSINGLE_FILE  => Uncaught SyntaxError: Cannot use 'import.meta' outside a module (at postgres.html:1:6033)
# -sENVIRONMENT=web => XHR
EMCC_WEB="-sNO_EXIT_RUNTIME=1 -sFORCE_FILESYSTEM=1"

# classic
MODULE="-sINVOKE_RUN=0 --shell-file /data/git/pglite-build/repl-nomod.html"

MODULE="-sMODULARIZE=0 -sEXPORT_ES6=0 --shell-file /data/git/pglite-build/repl-nomod.html"

# es6
MODULE="-sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=Module --shell-file ${GITHUB_WORKSPACE}/tests/repl.html"

# closure -sSIMPLE_OPTIMIZATION


# =======================================================
# size optimisations
# =======================================================

rm ${PGROOT}/lib/lib*.so.? 2>/dev/null

touch placeholder
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


#if [ -f ${EMSDK}/upstream/emscripten/src/library_pgfs.js ]
#then
#    echo custom FS support already added
#else
    cp ${GITHUB_WORKSPACE}/patches/library_pgfs.js ${EMSDK}/upstream/emscripten/src/library_pgfs.js
#fi


echo 'localhost:5432:postgres:postgres:password' > pgpass

emcc $EMCC_WEB -fPIC -sMAIN_MODULE=2 \
 -D__PYDK__=1 -DPREFIX=${PGROOT} \
 -sTOTAL_MEMORY=1GB -sSTACK_SIZE=4MB -sALLOW_TABLE_GROWTH -sALLOW_MEMORY_GROWTH -sGLOBAL_BASE=${CMA_MB}MB \
  $MODULE -sERROR_ON_UNDEFINED_SYMBOLS -sASSERTIONS=0 \
 -lnodefs.js -lpgfs.js \
 -sEXPORTED_RUNTIME_METHODS=FS,setValue,getValue,stringToNewUTF8,stringToUTF8OnStack,ccall,cwrap,callMain \
 -sEXPORTED_FUNCTIONS=_main,_getenv,_setenv,_interactive_one,_interactive_write,_interactive_read,_pg_initdb,_pg_shutdown \
 --preload-file ${PGROOT}/share/postgresql@${PGROOT}/share/postgresql \
 --preload-file ${PGROOT}/lib/postgresql@${PGROOT}/lib/postgresql \
 --preload-file ${PGROOT}/password@${PGROOT}/password \
 --preload-file pgpass@${PGROOT}/pgpass \
 --preload-file placeholder@${PGROOT}/bin/postgres \
 --preload-file placeholder@${PGROOT}/bin/initdb \
 -o postgres.html $PG_O $PG_L || exit 136

mkdir -p ${WEBROOT}/repl

[ -f "index.html" ] || echo "<html>
<body>
    <a href=repl/postgres.html>TEST REPL (xterm)</a>
    <hr/>
    <a href=repl/repl.html>TEST REPL (react+idbfs)</a>
    <hr/>
    <a href=repl/pgfs.html>TEST REPL (react+pgfs)</a>

</body>
</html>" > index.html

mv index.html ${WEBROOT}/
cp -v postgres.* ${WEBROOT}/repl/
cp ${PGROOT}/lib/libecpg.so ${WEBROOT}/repl/
cp ${PGROOT}/sdk/*.tar ${WEBROOT}/repl/

cp $GITHUB_WORKSPACE/{tests/vtx.js,patches/Repl.js,patches/repl.html,patches/pgfs.html} ${WEBROOT}/repl/
#du -hs ${WEBROOT}/repl/*
#du -hs ${WEBROOT}/*

popd

echo "
linkweb:end




"


