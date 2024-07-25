if [ -f postgresql/postgresql-${PGVERSION}.patched ]
then
    echo version already selected and patch stage already done
else
    git clone --no-tags --depth 1 --single-branch --branch master https://github.com/postgres/postgres postgresql-${PGVERSION}

    if pushd postgresql-${PGVERSION}
    then
            echo
        > ./src/template/emscripten
        > ./src/template/wasi
        > ./src/include/port/wasi.h
        > ./src/makefiles/Makefile.wasi
        for patchdir in \
            postgresql-debug postgresql-wasi \
            postgresql-wasm postgresql-wasm-${PGVERSION} \
            postgresql-pglite postgresql-pglite-${PGVERSION}
        do
            if [ -d ../patches/$patchdir ]
            then
                cat ../patches/$patchdir/*.diff | patch -p1 || exit 24
            fi
        done
        touch postgresql-${PGVERSION}.patched
        popd
    fi

    # either a submodule dir or a symlink.
    # release only use symlink

    rm postgresql 2>/dev/null
    ln -s postgresql-${PGVERSION} postgresql

fi

export PGSRC=$(realpath postgresql-${PGVERSION})

if [ -f ${PGROOT}/pg.installed ]
then
    echo "skipping pg build, using previous install from ${PGROOT}"
else
    if $WASI
    then

        echo "TODO $(which clang)"
    CNF="${PGSRC}/configure --prefix=${PGROOT} \
 --disable-spinlocks --disable-atomics \
 --without-zlib --disable-largefile --without-llvm \
 --without-pam --disable-largefile --without-zlib --with-openssl=no \
 --without-readline --without-icu \
 ${PGDEBUG}"

#  --cache-file=${PGROOT}/config.cache.wasi
    if \
     ZIC=/usr/sbin/zic \
     CC=wasi-c \
     CXX=wasi-c++ \
     CONFIG_SITE==${PGDATA}/config.site CONFIGURE=true \
     $CNF \
     --host=$(arch) --target=wasm32-unknown-wasi --with-template=wasi
    then
        echo configure ok
        make -j 1
    else
        echo configure failed
        exit 57
    fi

        read

    else
        echo "Building $ARCHIVE (patched) from $PGSRC"
        . cibuild/pgbuild.sh
    fi
fi

