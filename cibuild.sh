#!/bin/bash

# data transfer zone this is == (wire query size + result size ) + 2
# expressed in MB
export CMA_MB=${CMA_MB:-64}

export PGVERSION=${PGVERSION:-16.2}
export CI=${CI:-false}
export GITHUB_WORKSPACE=${GITHUB_WORKSPACE:-$(pwd)}
export PGROOT=${PGROOT:-/tmp/pglite}
export WEBROOT=${WEBROOT:-${GITHUB_WORKSPACE}/postgres}
export DEBUG=${DEBUG:-false}
export PGDATA=${PGROOT}/base
export PGUSER=postgres

# exit on error
EOE=false

# the default is a user writeable path.
if mkdir -p ${PGROOT}
then
    echo "checking for valid prefix ${PGROOT}"
else
    sudo mkdir -p ${PGROOT}
    sudo chown $(whoami) ${PGROOT}
fi

#TODO handle PGPASSFILE hostname:port:database:username:password correctly instead
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

if which emcc
then
    echo "Using provided emsdk from $(which emcc)"
else
    . /opt/python-wasm-sdk/wasm32-bi-emscripten-shell.sh
fi


# custom code for node/web builds that modify pg main/tools behaviour
# this used by both node/linkweb build stages
if $CI
then
    CC_PGLITE="-DPATCH_MAIN=${GITHUB_WORKSPACE}/patches/pg_main.c ${CC_PGLITE}"
    CC_PGLITE="-DPATCH_LOOP=${GITHUB_WORKSPACE}/patches/interactive_one.c ${CC_PGLITE}"
    CC_PGLITE="-DPATCH_PLUGIN=${GITHUB_WORKSPACE}/patches/pg_plugin.h ${CC_PGLITE}"
else
    CC_PGLITE="-DPATCH_MAIN=/data/git/pg/pg_main.c ${CC_PGLITE}"
    CC_PGLITE="-DPATCH_LOOP=/data/git/pg/interactive_one.c ${CC_PGLITE}"
    CC_PGLITE="-DPATCH_PLUGIN=/data/git/pg/pg_plugin.h ${CC_PGLITE}"
fi

export CC_PGLITE



if [ -f ${WEBROOT}/postgres.js ]
then
    echo using current from ${WEBROOT}
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
    cat > ${PGROOT}/locale <<END
C
C.UTF-8
POSIX
UTF-8
END

    # to get same path for wasm-shared link tool in the path
    # for extensions building.
    # we always symlink in-tree build to "postgresql" folder
    . cibuild/pg-$PGVERSION.sh

fi

# put wasm-shared the pg extension linker from build dir in the path
# and also pg_config from the install dir.
export PATH=${GITHUB_WORKSPACE}/build/postgres/bin:${PGROOT}/bin:$PATH




if echo "$*"|grep -q vector
then
    echo "================================================="

    pushd build
    [ -d pgvector ] || git clone --no-tags --depth 1 --single-branch --branch master https://github.com/pgvector/pgvector
        pushd pgvector
        # path for wasm-shared already set to (pwd:pg build dir)/bin
        # OPTFLAGS="" turns off arch optim (sse/neon).
        PG_CONFIG=${PGROOT}/bin/pg_config emmake make OPTFLAGS="" install
            pushd ${PGROOT}/share/postgresql/extension
                mv vector--0.7.0--0.7.1.sql vector--0.7.1.sql
                rm vector--*--*.sql
            popd
        popd
    popd
fi


if echo "$*"|grep " quack"
then
    echo "================================================="
    PG_LINK=em++ echo WIP
fi

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


if echo "$*"|grep "node"
then
    echo "================================================="
    mkdir -p /tmp/sdk/
    # remove versionned symlinks
    rm ${PGROOT}/lib/lib*.so.? 2>/dev/null
    if $CI
    then
        tar -cpRz ${PGROOT} > /tmp/sdk/pg.tar.gz
    fi
fi

# run linkweb after node build because it will remove some wasm .so used by node from fs
# they don't need to be in MEMFS as they are fetched.
if echo "$*"|grep "linkweb"
then
    echo "================================================="

    # build web version
    pushd build/postgres
    . $GITHUB_WORKSPACE/cibuild/linkweb.sh

    # upload all to gh pages,
    # TODO: include node archive and samples ?
    if $CI
    then
        mkdir -p /tmp/web/
        cp -r $WEBROOT/* /tmp/web/
    fi
    popd
fi


# pglite also use web build files, so make it last.

if echo "$*"|grep "pglite$"
then
    echo "================================================="
    . cibuild/pglite-ts.sh
fi



