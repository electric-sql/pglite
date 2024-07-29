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
export PGUSER=postgres
export PGPATCH=${WORKSPACE}/patches


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
    echo "debug not supported on web build"
    exit 51
else
    export PGDEBUG=""
    export CDEBUG="-g0 -Os"
fi

# setup compiler+node. emsdk provides node (18), recent enough for bun.
# TODO: but may need to adjust $PATH with stock emsdk.
if ${WASI:-false}
then
    echo "Wasi build (experimental)"
    . /opt/python-wasm-sdk/wasm32-wasi-shell.sh
else
    if which emcc
    then
        echo "Using provided emsdk from $(which emcc)"
    else
        . /opt/python-wasm-sdk/wasm32-bi-emscripten-shell.sh
    fi

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


if echo "$*"|grep -q " contrib"
then

    SKIP="\
 [\
 sslinfo bool_plperl hstore_plperl hstore_plpython jsonb_plperl jsonb_plpython\
 ltree_plpython pgcrypto sepgsql bool_plperl start-scripts uuid-ossp\
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
                if emmake make install
                then
                    popd
                    python3 cibuild/pack_extension.py

                else
                    popd
                    echo "

        Extension $ext from $extdir failed to build

"
                    exit 208
                fi
            fi
        fi
    read
    done
fi



if echo "$*"|grep -q "vector"
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
            PG_CONFIG=${PGROOT}/bin/pg_config emmake make OPTFLAGS="" install
            cp sql/vector.sql sql/vector--0.7.3.sql ${PGROOT}/share/postgresql/extension
            rm ${PGROOT}/share/postgresql/extension/vector--?.?.?--?.?.?.sql ${PGROOT}/share/postgresql/extension/vector.sql
        popd

    popd

    python3 cibuild/pack_extension.py

fi

if echo "$*"|grep -q "postgis"
then
    echo "======================= postgis : $(pwd) ==================="

    ./cibuild/postgis.sh

    python3 cibuild/pack_extension.py
fi

if echo "$*"|grep -q " quack"
then
    echo "================================================="
    ./cibuild/pg_quack.sh
    cp $PGROOT/lib/libduckdb.so /tmp/
    python3 cibuild/pack_extension.py
fi


# ===========================================================================
# ===========================================================================
#                               PGLite
# ===========================================================================
# ===========================================================================




# in pg git test mode we pull pglite instead
if [ -d pglite ]
then
    # to get  pglite/postgres populated by web build
    rmdir pglite/postgres pglite 2>/dev/null
    if [ -d pglite ]
    then
        echo using local
    else
        git clone --no-tags --depth 1 --single-branch --branch pglite-build https://github.com/electric-sql/pglite pglite
    fi
fi


# run this last so all extensions files can be packaged
# those include  *.control *.sql and *.so
# TODO: check if some versionned *.sql files can be omitted
# TODO: for bigger extensions than pgvector make separate packaging.

if echo "$*"|grep "node"
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

if echo "$*"|grep "linkweb"
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
</html>" > /tmp/web/index.html

            mkdir -p /tmp/web/pglite
            mkdir -p /tmp/web/repl

            PGLITE=$(pwd)/packages/pglite
            cp -r ${PGLITE}/dist /tmp/web/pglite/
            cp -r ${PGLITE}/examples /tmp/web/pglite/
            cp -r ${WORKSPACE}/packages/repl/dist-webcomponent /tmp/web/repl/
            cp -r ${WORKSPACE}/packages/benchmark /tmp/web/pglite/
        ;;
    esac
    shift
done


