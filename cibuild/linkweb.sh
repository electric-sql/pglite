#!/bin/bash

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

    PG_L="-L../../src/port -L../../src/common \
 ../../src/common/libpgcommon_srv.a ../../src/port/libpgport_srv.a"



if false
then
    # PG_L="$PG_L -L../../src/interfaces/ecpg/ecpglib ../../src/interfaces/ecpg/ecpglib/libecpg.so /tmp/pglite/lib/postgresql/libduckdb.so"
    PG_L="$PG_L -L../../src/interfaces/ecpg/ecpglib ../../src/interfaces/ecpg/ecpglib/libecpg.so /tmp/libduckdb.so -lstdc++"
else
    PG_L="$PG_L -L../../src/interfaces/ecpg/ecpglib ../../src/interfaces/ecpg/ecpglib/libecpg.so"
    PG_L="../../src/common/libpgcommon_srv.a ../../src/port/libpgport_srv.a ../.././src/interfaces/libpq/libpq.a"

fi

# ? -sLZ4=1  -sENVIRONMENT=web
# -sSINGLE_FILE  => Uncaught SyntaxError: Cannot use 'import.meta' outside a module (at postgres.html:1:6033)
# -sENVIRONMENT=web => XHR
EMCC_WEB="-sNO_EXIT_RUNTIME=1 -sFORCE_FILESYSTEM=1"

if ${PGES6:-true}
then
    # es6
    MODULE="-g0 -O2 -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=Module --shell-file ${GITHUB_WORKSPACE}/tests/repl.html"
else
    # local debug fast build
    MODULE="-g3 -O0 -sMODULARIZE=0 -sEXPORT_ES6=0 --shell-file ${GITHUB_WORKSPACE}/tests/repl.html"
fi

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

# cp ${GITHUB_WORKSPACE}/patches/library_pgfs.js ${EMSDK}/upstream/emscripten/src/library_pgfs.js


echo 'localhost:5432:postgres:postgres:password' > pgpass


if [ -f ${PGROOT}/symbols ]
then
    # _main,_getenv,_setenv,_interactive_one,_interactive_write,_interactive_read,_pg_initdb,_pg_shutdown

#not yet
#_emscripten_copy_from
#_emscripten_copy_to
#_emscripten_copy_to_end


    cat > exports <<END
___cxa_throw
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
END
    cat ${PGROOT}/symbols | sort | uniq \
     | grep -v _plpgsql_ \
     | grep -v duckdb \
     | grep -v ^_halfvec_l2_normalize \
     | grep -v ^_l2_normalize \
     | grep -v ^_sparsevec_l2_normalize \
     | grep -v ^_1 \
     | grep -v ^_\< \
     | grep -v ^_env$ \
     >> exports
    cat exports > ${GITHUB_WORKSPACE}/patches/exports
else
    cat ${GITHUB_WORKSPACE}/patches/exports >> exports
fi

# copyFrom,copyTo,copyToEnd

emcc $EMCC_WEB -fPIC -sMAIN_MODULE=2 \
 -D__PYDK__=1 -DPREFIX=${PGROOT} \
 -sTOTAL_MEMORY=1GB -sSTACK_SIZE=4MB -sALLOW_TABLE_GROWTH -sALLOW_MEMORY_GROWTH -sGLOBAL_BASE=${CMA_MB}MB \
  $MODULE -sERROR_ON_UNDEFINED_SYMBOLS -sASSERTIONS=0 \
 -lnodefs.js -lidbfs.js \
 -sEXPORTED_RUNTIME_METHODS=FS,setValue,getValue,UTF8ToString,stringToNewUTF8,stringToUTF8OnStack,ccall,cwrap,callMain \
 -sEXPORTED_FUNCTIONS=@exports \
 --preload-file ${PGROOT}/share/postgresql@${PGROOT}/share/postgresql \
 --preload-file ${PGROOT}/lib/postgresql@${PGROOT}/lib/postgresql \
 --preload-file ${PGROOT}/password@${PGROOT}/password \
 --preload-file pgpass@${PGROOT}/pgpass \
 --preload-file placeholder@${PGROOT}/bin/postgres \
 --preload-file placeholder@${PGROOT}/bin/initdb \
 -o postgres.html $PG_O $PG_L || exit 186

mkdir -p ${WEBROOT}

cp -v postgres.* ${WEBROOT}/
cp ${PGROOT}/sdk/*.tar ${WEBROOT}/
for tarf in ${WEBROOT}/*.tar
do
    gzip -f -9 $tarf
done


    cp $GITHUB_WORKSPACE/{tests/vtx.js,patches/tinytar.min.js} ${WEBROOT}/

    popd

echo "
linkweb:end




"




