echo "



pgbuild:begin

CC_PGLITE=$CC_PGLITE

"


    mkdir -p build/postgres
    pushd build/postgres
    
    # create empty package.json to avoid emsdk node conflicts
    # with root package.json of project
    echo "{}" > package.json


    if $CI
    then
        echo "CI : using build cache"
    else
        if [ -f Makefile ]
        then
            echo "Cleaning up previous build ..."
            make distclean 2>&1 > /dev/null
        fi
    fi


# TODO: fix sdk to support --with-uuid=ossp

    CNF="${PGSRC}/configure --prefix=${PGROOT} \
 --disable-spinlocks --disable-atomics \
 --without-zlib --disable-largefile --without-llvm \
 --without-pam --disable-largefile --without-zlib --with-openssl=no \
 --without-readline --without-icu --with-uuid=ossp \
 ${PGDEBUG}"

    echo "  ==== building wasm MVP:$MVP Debug=${PGDEBUG} with opts : $@  == "


    if [ -f ${PGROOT}/config.cache.emsdk ]
    then
        echo "re-using config cache file from ${PGROOT}/config.cache.emsdk"
    else
        if [ -f ../config.cache.emsdk ]
        then
            cp ../config.cache.emsdk ${PGROOT}/
        else
            cp config.cache.emsdk ${PGROOT}/
        fi
    fi

    # -lwebsocket.js -sPROXY_POSIX_SOCKETS -pthread -sPROXY_TO_PTHREAD
    # CONFIG_SITE=$(pwd)/config.site EMCC_CFLAGS="--oformat=html" \

    # crash clang CFLAGS=-Wno-error=implicit-function-declaration

    if EM_PKG_CONFIG_PATH=$PREFIX/lib/pkgconfig CONFIG_SITE==${PGDATA}/config.site emconfigure $CNF --with-template=emscripten --cache-file=${PGROOT}/config.cache.emsdk
    then
        echo configure ok
    else
        echo configure failed
        exit 262
    fi

    if grep -q MAIN_MODULE ${PGSRC}/src/backend/Makefile
    then
        echo "dyld server patch ok"
    else
        echo "missing server dyld patch"
        exit 273
    fi
    mkdir -p bin

    cat > bin/zic <<END
#!/bin/bash
#. /opt/python-wasm-sdk/wasm32-bi-emscripten-shell.sh
TZ=UTC PGTZ=UTC node $(pwd)/src/timezone/zic \$@
END

    # --disable-shared not supported so be able to use a fake linker

    > /tmp/disable-shared.log

    cat > bin/wasm-shared <<END
#!/bin/bash
echo "[\$(pwd)] $0 \$@" >> /tmp/disable-shared.log
# shared build
\${PG_LINK:-emcc} -L${PREFIX}/lib -DPREFIX=${PGROOT} -shared -sSIDE_MODULE=1 \$@ -Wno-unused-function
END

    # FIXME: workaround for /conversion_procs/ make
    # cp bin/wasm-shared bin/o
    ZIC=${ZIC:-$(realpath bin/zic)}
    chmod +x bin/zic bin/wasm-shared

    # for zic and wasm-shared
    export PATH=$(pwd)/bin:$PATH


    EMCC_WEB="-sNO_EXIT_RUNTIME=1 -sENVIRONMENT=web"
    EMCC_NODE="-sEXIT_RUNTIME=1 -DEXIT_RUNTIME -sNODERAWFS -sENVIRONMENT=node"

    # -lwebsocket.js"
    # -sWEBSOCKET_SUBPROTOCOL=binary -sWEBSOCKET_URL=ws://127.0.0.1:25432"

    # -lwebsocket.js
    # -sPROXY_POSIX_SOCKETS -pthread -sPROXY_TO_PTHREAD $EMCC_CFLAGS"

    #  -sWASMFS

    EMCC_ENV="${EMCC_NODE} -sFORCE_FILESYSTEM=0"
    EMCC_ENV="${EMCC_NODE} -sERROR_ON_UNDEFINED_SYMBOLS"

    # only required for static initdb
    EMCC_CFLAGS="-sERROR_ON_UNDEFINED_SYMBOLS=0 ${CC_PGLITE}"
    EMCC_CFLAGS="${EMCC_CFLAGS} -sTOTAL_MEMORY=1GB -sSTACK_SIZE=5MB -sALLOW_TABLE_GROWTH -sALLOW_MEMORY_GROWTH -sGLOBAL_BASE=${CMA_MB}MB"
    EMCC_CFLAGS="${EMCC_CFLAGS} -DPREFIX=${PGROOT}"

    export EMCC_CFLAGS="${EMCC_CFLAGS} -Wno-macro-redefined -Wno-unused-function"


	if EMCC_CFLAGS="${EMCC_ENV} ${EMCC_CFLAGS}" emmake make ZIC=$ZIC -j $(nproc) 2>&1 > /tmp/build.log
	then
        echo build ok
        # for 32bits zic
        unset LD_PRELOAD
        if EMCC_CFLAGS="${EMCC_ENV} ${EMCC_CFLAGS}" emmake make ZIC=$ZIC install 2>&1 > /tmp/install.log
        then
            echo install ok
            pushd ${PGROOT}
            #find ./lib/postgresql ./share/postgresql/extension -type f > ${PGROOT}/pg.installed
            find . -type f | grep -v plpgsql > ${PGROOT}/pg.installed
            popd

            goback=$(pwd)
            popd
            python3 cibuild/pack_extension.py builtin
            pushd $goback

            pushd ${PGROOT}
            find . -type f  > ${PGROOT}/pg.installed
            popd

        else
            cat /tmp/install.log
            echo "install failed"
            exit 143
        fi
    else
        cat /tmp/build.log
        echo "build failed"
        exit 148
	fi

    # wip
    mv -vf ./src/bin/psql/psql.wasm ./src/bin/pg_config/pg_config.wasm ${PGROOT}/bin/
    mv -vf ./src/bin/pg_dump/pg_restore.wasm ./src/bin/pg_dump/pg_dump.wasm ./src/bin/pg_dump/pg_dumpall.wasm ${PGROOT}/bin/
	mv -vf ./src/bin/pg_resetwal/pg_resetwal.wasm  ./src/bin/initdb/initdb.wasm ./src/backend/postgres.wasm ${PGROOT}/bin/

    mv -vf ${PGROOT}/bin/pg_config ${PGROOT}/bin/pg_config.js
	mv -vf ./src/bin/initdb/initdb ${PGROOT}/bin/initdb.js
	mv -vf ./src/bin/pg_resetwal/pg_resetwal ${PGROOT}/bin/pg_resetwal.js
	mv -vf ./src/backend/postgres ${PGROOT}/bin/postgres.js

    cat > ${PGROOT}/bin/pg_config <<END
#!/bin/bash
node ${PGROOT}/bin/pg_config.js \$@
END

    cat  > ${PGROOT}/postgres <<END
#!/bin/bash
. /opt/python-wasm-sdk/wasm32-bi-emscripten-shell.sh
TZ=UTC PGTZ=UTC PGDATA=${PGDATA} node ${PGROOT}/bin/postgres.js \$@
END

# remove the abort but stall prompt
#  2>&1 | grep --line-buffered -v ^var\\ Module

    # force node wasm version
    cp -vf ${PGROOT}/postgres ${PGROOT}/bin/postgres

	cat  > ${PGROOT}/initdb <<END
#!/bin/bash
. /opt/python-wasm-sdk/wasm32-bi-emscripten-shell.sh
TZ=UTC PGTZ=UTC node ${PGROOT}/bin/initdb.js \$@
END

    chmod +x ${PGROOT}/postgres ${PGROOT}/bin/postgres
	chmod +x ${PGROOT}/initdb ${PGROOT}/bin/initdb

    # for extensions building
    chmod +x ${PGROOT}/bin/pg_config


	echo "initdb for PGDATA=${PGDATA} "

    # create empty db hack

	cat >$PGROOT/initdb.sh <<END
#!/bin/bash
rm -rf ${PGDATA} /tmp/initdb-* ${PGROOT}/wal/*
export TZ=UTC
export PGTZ=UTC
SQL=/tmp/initdb-\$\$
# TODO: --waldir=${PREFIX}/wal
> /tmp/initdb.txt

${PGROOT}/initdb --no-clean --wal-segsize=1 -g $LANG $CRED --pgdata=${PGDATA}

mv /tmp/initdb.boot.txt \${SQL}.boot.sql
mv /tmp/initdb.single.txt \${SQL}.single.sql

if \${CI:-false}
then
    cp -vf \$SQL ${PGROOT}/\$(md5sum \$SQL|cut -c1-32).sql
fi

# --wal-segsize=1  -> -X 1048576

# CKSUM_B -k --data-checksums
# 2024-04-24 05:53:28.121 GMT [42] WARNING:  page verification failed, calculated checksum 5487 but expected 0
# 2024-04-24 05:53:28.121 GMT [42] FATAL:  invalid page in block 0 of relation base/1/1259

CMD="${PGROOT}/postgres --boot -D ${PGDATA} -d 3 $PGOPTS -X 1048576"
echo "\$CMD < \$SQL.boot.sql"
\$CMD < \$SQL.boot.sql 2>&1 \\
 | grep -v --line-buffered 'bootstrap> boot' \\
 | grep -v --line-buffered 'index'

echo "

\$(md5sum /tmp/initdb-\$\$.*.sql)

    boot done
"
END

    popd
echo "pgbuild:end




"



