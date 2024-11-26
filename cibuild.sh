#!/bin/bash

# data transfer zone this is == (wire query size + result size ) + 2
# expressed in EMSDK MB
export CMA_MB=${CMA_MB:-64}

export CI=${CI:-false}

if $CI
then
    . .buildconfig
fi

export PG_VERSION=${PG_VERSION:-16.4}
export WORKSPACE=${GITHUB_WORKSPACE:-$(pwd)}
export PGROOT=${PGROOT:-/tmp/pglite}
export WEBROOT=${WEBROOT:-/tmp/web}
export DEBUG=${DEBUG:-false}
export PGDATA=${PGROOT}/base
export PGUSER=${PGUSER:-postgres}
export PGPATCH=${WORKSPACE}/patches
export TOTAL_MEMORY=${TOTAL_MEMORY:-128MB}
export WASI=${WASI:-false}


# exit on error
EOE=false

mkdir -p /tmp/sdk

# the default is a user writeable path.
if mkdir -p ${PGROOT}/sdk
then
    echo "checking for valid prefix ${PGROOT}"
else
    sudo mkdir -p ${PGROOT}/sdk ${PGROOT}/bin
    sudo chown $(whoami) -R ${PGROOT}
fi

# TODO: also handle PGPASSFILE hostname:port:database:username:password
# https://www.postgresql.org/docs/devel/libpq-pgpass.html
export CRED="-U $PGUSER --pwfile=${PGROOT}/password"

if [ -f ${PGROOT}/password ]
then
    echo "not changing db password"
    PGPASS=$(cat ${PGROOT}/password)
else
    PGPASS=${PGPASS:-password}
    echo ${PGPASS:-password} > ${PGROOT}/password
fi

export PGPASS


export PG_DEBUG_HEADER="${PGROOT}/include/pg_debug.h"


echo "
System node/pnpm ( may interfer) :

        node : $(which node) $(which node && $(which node) -v)
        PNPM : $(which pnpm)


"



# setup compiler+node. emsdk provides node (18), recent enough for bun.
# TODO: but may need to adjust $PATH with stock emsdk.

if ${WASI:-false}
then
    echo "Wasi build (experimental)"
    . /opt/python-wasm-sdk/wasm32-wasi-shell.sh

else
    if which emcc
    then
        echo "emcc found in PATH=$PATH"
    else
        . /opt/python-wasm-sdk/wasm32-bi-emscripten-shell.sh
    fi
    export PG_LINK=${PG_LINK:-$(which emcc)}

    echo "

    Using provided emsdk from $(which emcc)
    Using PG_LINK=$PG_LINK as linker

        node : $(which node) $($(which node) -v)
        PNPM : $(which pnpm)


"

    # custom code for node/web builds that modify pg main/tools behaviour
    # this used by both node/linkweb build stages

    # pass the "kernel" contiguous memory zone size to the C compiler.
    CC_PGLITE="-DCMA_MB=${CMA_MB}"

fi

# these are files that shadow original portion of pg core, with minimal changes
# to original code
# some may be included multiple time
CC_PGLITE="-DPATCH_MAIN=${WORKSPACE}/patches/pg_main.c ${CC_PGLITE}"
CC_PGLITE="-DPATCH_LOOP=${WORKSPACE}/patches/interactive_one.c ${CC_PGLITE}"
CC_PGLITE="-DPATCH_PLUGIN=${WORKSPACE}/patches/pg_plugin.h ${CC_PGLITE}"
CC_PGLITE="-DPATCH_PG_DEBUG=${PG_DEBUG_HEADER} ${CC_PGLITE}"


export CC_PGLITE
export PGPRELOAD="\
--preload-file ${PGROOT}/share/postgresql@${PGROOT}/share/postgresql \
--preload-file ${PGROOT}/lib/postgresql@${PGROOT}/lib/postgresql \
--preload-file ${PGROOT}/password@${PGROOT}/password \
--preload-file ${PGROOT}/PGPASSFILE@/home/web_user/.pgpass \
--preload-file placeholder@${PGROOT}/bin/postgres \
--preload-file placeholder@${PGROOT}/bin/initdb\
"

# ========================= symbol extractor ============================

OBJDUMP=${OBJDUMP:-true}

if $OBJDUMP
then
    if [ -f $PGROOT/bin/wasm-objdump ]
    then
        echo "wasm-objdump found"
    else
        WRAPPER=$(which wasm-objdump)
        WASIFILE=$(realpath ${WRAPPER}.wasi)
        if $WRAPPER -h $WASIFILE | grep -q 'file format wasm 0x1'
        then
            mkdir -p $PGROOT/bin/
            if cp -f $WRAPPER $WASIFILE $PGROOT/bin/
            then
                echo "wasm-objdump found and working, and copied to $PGROOT/bin/"
            else
                OBJDUMP=false
            fi
        else
            echo "
        ERROR: $(which wasm-objdump) is not working properly ( is wasmtime ok ? )

    "
            OBJDUMP=false
        fi
    fi
else
    echo "

    WARNING: OBJDUMP disabled, some newer or complex extensions may not load properly


"
fi

if $OBJDUMP
then
    mkdir -p patches/imports patches/imports.pgcore
else
    echo "

    WARNING:    wasm-objdump not found or OBJDUMP disabled, some extensions may not load properly


"
fi

export OBJDUMP


# ========================= pg core configuration ============================

# testing postgres.js file instead of ${PGROOT}/pgopts.sh because build should not have failed.
if [ -f ${WEBROOT}/postgres.js ]
then
    echo using current from ${WEBROOT}

    . ${PGROOT}/pgopts.sh

else

    # default to web/release size optim.

    mkdir -p ${PGROOT}/include
    if $DEBUG
    then
        export PGDEBUG=""
        export CDEBUG="-g3 -O0"
        export LDEBUG="-g3 -O0"
        cat > ${PG_DEBUG_HEADER} << END
#ifndef I_PGDEBUG
#define I_PGDEBUG
#define WASM_USERNAME "$PGUSER"
#define PGDEBUG 1
#define PDEBUG(string) puts(string)
#define JSDEBUG(string) {EM_ASM({ console.log(string); });}
#define ADEBUG(string) { PDEBUG(string); JSDEBUG(string) }
#endif
END

    else
        export PGDEBUG=""
        export CDEBUG="-g3 -O0"
        export LDEBUG="-g3 -O0"
        cat > ${PG_DEBUG_HEADER} << END
#ifndef I_PGDEBUG
#define I_PGDEBUG
#define WASM_USERNAME "$PGUSER"
#define PDEBUG(string)
#define JSDEBUG(string)
#define ADEBUG(string)
#define PGDEBUG 0
#endif
END
    fi

    mkdir -p ${PGROOT}/include/postgresql/server
    cp ${PG_DEBUG_HEADER} ${PGROOT}/include/
    cp ${PG_DEBUG_HEADER} ${PGROOT}/include/postgresql
    cp ${PG_DEBUG_HEADER} ${PGROOT}/include/postgresql/server

    # store all pg options that have impact on cmd line initdb/boot
    cat > ${PGROOT}/pgopts.sh <<END
export CDEBUG="$CDEBUG"
export LDEBUG="$LDEBUG"
export PGDEBUG="$PGDEBUG"
export PG_DEBUG_HEADER=$PG_DEBUG_HEADER
export PGOPTS="\\
 -c log_checkpoints=false \\
 -c dynamic_shared_memory_type=posix \\
 -c search_path=pg_catalog \\
 -c exit_on_error=$EOE \\
 -c ignore_invalid_pages=on \\
 -c temp_buffers=8MB -c work_mem=4MB \\
 -c fsync=on -c synchronous_commit=on \\
 -c wal_buffers=4MB -c min_wal_size=80MB \\
 -c shared_buffers=128MB"
END

    . ${PGROOT}/pgopts.sh

    # make sure no non-mvp feature gets in.
    cat > ${PGROOT}/config.site <<END
pgac_cv_sse42_crc32_intrinsics_=no
pgac_cv_sse42_crc32_intrinsics__msse4_2=no
pgac_sse42_crc32_intrinsics=no
pgac_armv8_crc32c_intrinsics=no
ac_cv_search_sem_open=no
END


    # workaround no "locale -a" for Node.
    # this is simply the minimal result a popen call would give.
    mkdir -p ${PGROOT}/etc/postgresql
    cat > ${PGROOT}/etc/postgresql/locale <<END
C
C.UTF-8
POSIX
UTF-8
END


    # to get same path for wasm shared link tools in the path
    # for extensions building.
    # we always symlink in-tree build to "postgresql" folder
    if echo $PG_VERSION|grep -q ^16
    then
        . cibuild/pg-16.x.sh
    else
        . cibuild/pg-git.sh
    fi

    # install emsdk-shared along with pg config  tool
    # for building user ext.
    cp build/postgres/bin/emsdk-shared $PGROOT/bin/

    export PGLITE=$(pwd)/packages/pglite

    echo "export PGSRC=${PGSRC}" >> ${PGROOT}/pgopts.sh
    echo "export PGLITE=${PGLITE}" >> ${PGROOT}/pgopts.sh


fi

# put emsdk-shared the pg extension linker from build dir in the path
# and also pg_config from the install dir.
export PATH=${WORKSPACE}/build/postgres/bin:${PGROOT}/bin:$PATH



# At this stage, PG should be installed to PREFIX and ready for linking
# or building ext.




# ===========================================================================
# ===========================================================================
#                             EXTENSIONS
# ===========================================================================
# ===========================================================================

if echo " $*"|grep -q " contrib"
then
    # TEMP FIX for SDK
    SSL_INCDIR=$EMSDK/upstream/emscripten/cache/sysroot/include/openssl
    [ -f $SSL_INCDIR/evp.h ] || ln -s $PREFIX/include/openssl $SSL_INCDIR
    SKIP="\
 [\
 sslinfo bool_plperl hstore_plperl hstore_plpython jsonb_plperl jsonb_plpython\
 ltree_plpython sepgsql bool_plperl start-scripts\
 ]"

    for extdir in postgresql/contrib/*
    do
        if [ -d "$extdir" ]
        then
            ext=$(echo -n $extdir|cut -d/ -f3)
            if echo -n $SKIP|grep -q "$ext "
            then
                echo skipping extension $ext
            else
                echo "

        Building contrib extension : $ext : begin
"
                pushd build/postgres/contrib/$ext
                if PATH=$PREFIX/bin:$PATH emmake make install
                then
                    echo "
        Building contrib extension : $ext : end
"
                else
                    echo "

        Extension $ext from $extdir failed to build

"
                    exit 216
                fi
                popd
                python3 cibuild/pack_extension.py

            fi
        fi
    done


fi

 if echo " $*"|grep -q " extra"
then
    for extra_ext in  ${EXTRA_EXT:-"vector"}
    do
        if $CI
        then
            if [ -d $PREFIX/include/X11 ]
            then
                echo -n
            else
                # install EXTRA sdk
                . /etc/lsb-release
                DISTRIB="${DISTRIB_ID}-${DISTRIB_RELEASE}"
                CIVER=${CIVER:-$DISTRIB}
                SDK_URL=https://github.com/pygame-web/python-wasm-sdk-extra/releases/download/$SDK_VERSION/python-emsdk-sdk-extra-${CIVER}.tar.lz4
                echo "Installing $SDK_URL"
                curl -sL --retry 5 $SDK_URL | tar xvP --use-compress-program=lz4 | pv -p -l -s 15000 >/dev/null
                chmod +x ./extra/*.sh
            fi
        fi
        echo "======================= ${extra_ext} : $(pwd) ==================="

        ./extra/${extra_ext}.sh || exit 400

        python3 cibuild/pack_extension.py
    done
fi

# ===========================================================================
# ===========================================================================
#                               PGLite
# ===========================================================================
# ===========================================================================


# run this last so all extensions files can be packaged
# those include  *.control *.sql and *.so
# TODO: check if some versionned *.sql files can be omitted
# TODO: for bigger extensions than pgvector make separate packaging.

if echo " $*"|grep " node"
then
    echo "====================== node : $(pwd) ========================"
    mkdir -p /tmp/sdk/

    # remove versionned symlinks
    rm ${PGROOT}/lib/lib*.so.? 2>/dev/null

    if $WASI
    then
        tar -cpRz ${PGROOT} > /tmp/sdk/postgres-${PG_VERSION}-wasisdk.tar.gz
    else
        tar -cpRz ${PGROOT} > /tmp/sdk/postgres-${PG_VERSION}-emsdk.tar.gz
    fi

fi

# run linkweb after node build because it may remove some wasm .so used by node from fs
# as they don't need to be in MEMFS since they are fetched.

# include current pglite source for easy local rebuild with just npm run build:js.

if echo " $*"|grep " linkweb"
then

    # build web version
    echo "========== linkweb : $(pwd) =================="
    pushd build/postgres
        . $WORKSPACE/cibuild/linkweb.sh
    popd
fi


# pglite* also use web build files, so order them last.


while test $# -gt 0
do
    case "$1" in

        pglite) echo "=================== pglite : $(pwd) ======================="
            # TODO: SAMs NOTE - Not using this in GitHub action as it doesnt resolve pnpm correctly
            # replaced with pglite-prep and pglite-bundle-sdk

            pushd ${PGLITE}
                pnpm install --frozen-lockfile

                mkdir -p $PGLITE/release
                rm $PGLITE/release/* 2>/dev/null


                # copy packed extensions for dist
                echo "

__________________________ enabled extensions (dlfcn)_____________________________
"
    cp -vf ${WEBROOT}/*.tar.gz ${PGLITE}/release/
echo "
__________________________________________________________________________________
"

                # copy wasm web prebuilt artifacts to release folder
                # TODO: get them from web for nosdk systems.

                cp -vf ${WEBROOT}/postgres.{js,data,wasm} ${PGLITE}/release/

                # debug CI does not use pnpm/npm for building pg, so call the typescript build
                # part from here
                pnpm --filter "pglite^..." build || exit 450

                pnpm pack || exit 31
                packed=$(echo -n electric-sql-pglite-*.tgz)

                mv $packed /tmp/sdk/pg${PG_VERSION}-${packed}

                # for repl demo
#                mkdir -p /tmp/web/pglite

                #cp -r ${PGLITE}/dist ${WEBROOT}/pglite/
                #cp -r ${PGLITE}/examples ${WEBROOT}/pglite/

#                for dir in /tmp/web ${WEBROOT}/pglite/examples
#                do
#                    pushd "$dir"
#                    cp ${PGLITE}/dist/postgres.data ./
#                    popd
#                done

                echo "<html>
                <body>
                    <ul>
                        <li><a href=./pglite/examples/repl.html>PGlite REPL (in-memory)</a></li>
                        <li><a href=./pglite/examples/repl-idb.html>PGlite REPL (indexedDB)</a></li>
                        <li><a href=./pglite/examples/notify.html>list/notify test</a></li>
                        <li><a href=./pglite/examples/index.html>All PGlite Examples</a></li>
                        <li><a href=./pglite/benchmark/index.html>Benchmarks</a> / <a href=./pglite/benchmark/rtt.html>RTT Benchmarks</a></li>
                        <li><a href=./postgres.html>Postgres xterm REPL</a></li>
                    </ul>
                </body>
                </html>" > ${WEBROOT}/index.html

            popd

            mkdir -p ${PGROOT}/sdk/packages/ /tmp/web/pglite /tmp/web/repl/
            cp -r $PGLITE ${PGROOT}/sdk/packages/

            #mkdir /tmp/web/repl/dist-webcomponent -p
            #cp -r ${WORKSPACE}/packages/pglite-repl/dist-webcomponent /tmp/web/repl/

            if $CI
            then
                tar -cpRz ${PGROOT} > /tmp/sdk/pglite-pg${PG_VERSION}.tar.gz

                # build sdk (node)
                cp /tmp/sdk/postgres-${PG_VERSION}.tar.gz ${WEBROOT}/

                # pglite (web)
                cp /tmp/sdk/pglite-pg${PG_VERSION}.tar.gz ${WEBROOT}/

            fi

            du -hs ${WEBROOT}/*
        ;;

        pglite-test) echo "================== pglite-test ========================="
            export PATH=$PATH:$(pwd)/node_modules/.bin
            pushd ./packages/pglite
            #npm install -g concurrently playwright ava http-server pg-protocol serve tinytar buffer async-mutex 2>&1 > /dev/null
            pnpm install --prefix . 2>&1 >/dev/null
            pnpm run build 2>&1 >/dev/null
            if pnpm exec playwright install --with-deps 2>&1 >/dev/null
            then
                pnpm --filter "pglite^..." test || exit 534
                pnpm test:web || pnpm test:web || pnpm test:web || exit 535
            else
                echo "failed to install web-test env"
                pnpm --filter "pglite^..." test || exit 538
            fi
            pnpm pack
            popd
        ;;

        pglite-prep) echo "==================== pglite-prep  =========================="
            mkdir -p $PGLITE/release
            #rm $PGLITE/release/*

            # copy packed extensions
            cp -vf ${WEBROOT}/*.tar.gz ${PGLITE}/release/
            cp -vf ${WEBROOT}/postgres.{js,data,wasm} $PGLITE/release/
        ;;

        pglite-bundle-interim) echo "================== pglite-bundle-interim ======================"
            tar -cpRz ${PGLITE}/release > /tmp/sdk/pglite-interim-${PG_VERSION}.tar.gz
        ;;

        demo-site) echo "==================== demo-site =========================="
            # Move all existing files to a subfolder
            mkdir -p /tmp/web/x-term-repl
            mv /tmp/web/* /tmp/web/x-term-repl/

            mkdir -p /tmp/web/dist
            mkdir -p /tmp/web/examples
            mkdir -p /tmp/web/benchmark

            PGLITE=$(pwd)/packages/pglite
            cp -r ${PGLITE}/dist/* /tmp/web/dist/
            cp -r ${PGLITE}/examples/* /tmp/web/examples/
            cp -r ${WORKSPACE}/packages/benchmark/dist/* /tmp/web/benchmark/
        ;;
    esac
    shift
done


