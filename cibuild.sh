#!/bin/bash

# data transfer zone this is == (wire query size + result size ) + 2
# expressed in EMSDK MB
export CMA_MB=${CMA_MB:-64}

export PGVERSION=${PGVERSION:-16.3}
export CI=${CI:-false}
export WORKSPACE=${GITHUB_WORKSPACE:-$(pwd)}
export PGROOT=${PGROOT:-/tmp/pglite}
export WEBROOT=${WEBROOT:-/tmp/web}
export DEBUG=${DEBUG:-false}
export PGDATA=${PGROOT}/base
export PGUSER=${PGUSER:-postgres}
export PGPATCH=${WORKSPACE}/patches
export TOTAL_MEMORY=${TOTAL_MEMORY:-256MB}

# exit on error
EOE=false

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

if which wasm-objdump
then
    cp $(which wasm-objdump) $PGROOT/bin/
fi

# default to web/release size optim.
if $DEBUG
then
    export PGDEBUG=""
    export CDEBUG="-g0 -O0"
    cat > /tmp/pgdebug.h << END
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
    export CDEBUG="-g0 -O2"
    cat > /tmp/pgdebug.h << END
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

echo "

        node : $(which node) $($(which node) -v)
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

    # these are files that shadow original portion of pg core, with minimal changes
    # to original code
    # some may be included multiple time
    CC_PGLITE="-DPATCH_MAIN=${WORKSPACE}/patches/pg_main.c ${CC_PGLITE}"
    CC_PGLITE="-DPATCH_LOOP=${WORKSPACE}/patches/interactive_one.c ${CC_PGLITE}"
    CC_PGLITE="-DPATCH_PLUGIN=${WORKSPACE}/patches/pg_plugin.h ${CC_PGLITE}"

fi


export CC_PGLITE


if [ -f ${WEBROOT}/postgres.js ]
then
    echo using current from ${WEBROOT}

    . ${PGROOT}/pgopts.sh

else

    # store all pg options that have impact on cmd line initdb/boot
    cat > ${PGROOT}/pgopts.sh <<END
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


    # to get same path for wasm-shared link tool in the path
    # for extensions building.
    # we always symlink in-tree build to "postgresql" folder
    if echo $PGVERSION|grep -q ^16
    then
        . cibuild/pg-16.x.sh
    else
        . cibuild/pg-git.sh
    fi

    # install wasm-shared along with pg config  tool
    # for building user ext.
    cp build/postgres/bin/wasm-shared $PGROOT/bin/

    export PGLITE=$(pwd)/packages/pglite

    echo "export PGSRC=${PGSRC}" >> ${PGROOT}/pgopts.sh
    echo "export PGLITE=${PGLITE}" >> ${PGROOT}/pgopts.sh


fi

# put wasm-shared the pg extension linker from build dir in the path
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

if ${EXTRA_EXT:-true}
then
    if echo " $*"|grep -q " vector"
    then
        echo "====================== vector : $(pwd) ================="

        pushd build

            # [ -d pgvector ] || git clone --no-tags --depth 1 --single-branch --branch master https://github.com/pgvector/pgvector

            if [ -d pgvector ]
            then
                echo using local pgvector
            else
                wget -c -q https://github.com/pgvector/pgvector/archive/refs/tags/v0.7.3.tar.gz -Opgvector.tar.gz
                tar xvfz pgvector.tar.gz && rm pgvector.tar.gz
                mv pgvector-?.?.? pgvector
            fi

            pushd pgvector
                # path for wasm-shared already set to (pwd:pg build dir)/bin
                # OPTFLAGS="" turns off arch optim (sse/neon).
                PG_CONFIG=${PGROOT}/bin/pg_config emmake make OPTFLAGS="" install || exit 276
                cp sql/vector.sql sql/vector--0.7.3.sql ${PGROOT}/share/postgresql/extension
                rm ${PGROOT}/share/postgresql/extension/vector--?.?.?--?.?.?.sql ${PGROOT}/share/postgresql/extension/vector.sql
            popd

        popd

        python3 cibuild/pack_extension.py

    fi

    if echo " $*"|grep -q " postgis"
    then
        echo "======================= postgis : $(pwd) ==================="

        ./cibuild/postgis.sh

        python3 cibuild/pack_extension.py
    fi

    if echo " $*"|grep -q " quack"
    then
        echo "================================================="
        ./cibuild/pg_quack.sh || exit 299
        cp $PGROOT/lib/libduckdb.so /tmp/
        python3 cibuild/pack_extension.py
    fi
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
    if $CI
    then
        tar -cpRz ${PGROOT} > /tmp/sdk/postgres-${PGVERSION}.tar.gz
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

    # upload all to gh pages,
    # TODO: include node archive and samples ?
    if $CI
    then
        mkdir -p /tmp/web/
        cp -r $WEBROOT/* /tmp/web/
    fi
    popd
fi


# pglite* also use web build files, so order them last.


while test $# -gt 0
do
    case "$1" in

        pglite) echo "=================== pglite : $(pwd) ======================="
            # TODO: SAMs NOTE - Not using this in GitHub action as it doesnt resolve pnpm correctly
            # replaced with pglite-prep and pglite-bundle-sdk

            . cibuild/pglite-ts.sh

            # copy needed files for a minimal js/ts/extension build
            # NB: these don't use NODE FS

            mkdir -p ${PGROOT}/sdk/packages/ /tmp/web/pglite /tmp/web/repl/
            cp -r $PGLITE ${PGROOT}/sdk/packages/

            mkdir /tmp/web/repl/dist-webcomponent -p
            cp -r ${WORKSPACE}/packages/repl/dist-webcomponent /tmp/web/repl/

            if $CI
            then
                tar -cpRz ${PGROOT} > /tmp/sdk/pglite-pg${PGVERSION}.tar.gz
            fi

            du -hs ${WEBROOT}/*
        ;;

        pglite-repl) echo "=============== pglite-repl ================================"
            PATH=$PATH:$PREFIX/bin
            pushd ./packages/repl
            pnpm install
            pnpm run build
            popd
        ;;

        pglite-test) echo "================== pglite-test ========================="
            echo "
        node : $(which node) $($(which node) -v)
        PNPM : $(which pnpm)
"
            export PATH=$PATH:$(pwd)/node_modules/.bin
            pushd ./packages/pglite
            #npm install -g concurrently playwright ava http-server pg-protocol serve tinytar buffer async-mutex 2>&1 > /dev/null
            pnpm install --prefix .
            pnpm run build
            if pnpm exec playwright install --with-deps
            then
                pnpm run test || exit 429
            else
                echo "failed to install test env"
                pnpm run test || exit 432
            fi
            popd
        ;;

        pglite-prep) echo "==================== pglite-prep  =========================="
            mkdir -p $PGLITE/release
            rm $PGLITE/release/*

            # copy packed extensions
            cp ${WEBROOT}/*.tar.gz ${PGLITE}/release/
            cp -vf ${WEBROOT}/postgres.{js,data,wasm} $PGLITE/release/
        ;;

        pglite-bundle-interim) echo "================== pglite-bundle-interim ======================"
            tar -cpRz ${PGLITE}/release > /tmp/sdk/pglite-interim-${PGVERSION}.tar.gz
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


