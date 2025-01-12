if [ -f postgresql/postgresql-${PG_VERSION}.patched ]
then
    echo version already selected and patch stage already done
else
    git clone --no-tags --depth 1 --single-branch --branch master https://github.com/postgres/postgres postgresql-${PG_VERSION}

    if pushd postgresql-${PG_VERSION}
    then
            echo
        > ./src/template/emscripten
        > ./src/template/wasi
        > ./src/include/port/wasi.h
        > ./src/makefiles/Makefile.wasi
        for patchdir in \
            postgresql-debug postgresql-wasi \
            postgresql-wasm postgresql-wasm-${PG_VERSION} \
            postgresql-pglite postgresql-pglite-${PG_VERSION}
        do
            if [ -d ../patches/$patchdir ]
            then
                cat ../patches/$patchdir/*.diff | patch -p1 || exit 24
            fi
        done
        touch postgresql-${PG_VERSION}.patched
        popd
    fi

    # either a submodule dir or a symlink.
    # release only use symlink
    [ -f postgresql/configure ] && rm postgresql 2>/dev/null

    ln -s postgresql-${PG_VERSION} postgresql

fi

export PGSRC=$(realpath postgresql-${PG_VERSION})

if [ -f ${PGROOT}/pg.installed ]
then
    echo "skipping pg build, using previous install from ${PGROOT}"
else
    if $WASI
    then

        cat > $PGROOT/bin/wasi-shared <<END
#!/bin/bash
echo "[\$(pwd)] $0 \$@" >> /tmp/disable-shared.log
# shared build
echo ===================================================================================
wasi-c -L${PREFIX}/lib -DPREFIX=${PGROOT} -shared \$@ -Wno-unused-function
echo ===================================================================================
END

        chmod +x $PGROOT/bin/wasi-shared
        chmod +x $PGROOT/bin/wasi-shared $PGROOT/bin/emsdk-shared

        # for zic and emsdk-shared/wasi-shared called from makefile
        export PATH=$(pwd)/bin:$PGROOT/bin:$PATH

        FLAGS="${CC_PGLITE} -DPREFIX=${PGROOT} -DPYDK=1 -Wno-declaration-after-statement -Wno-macro-redefined -Wno-unused-function -Wno-missing-prototypes -Wno-incompatible-pointer-types"
        echo "

WASI_CFLAGS=$FLAGS


TODO: wasi zic


"

        read

        CNF="${PGSRC}/configure --prefix=${PGROOT} \
 --disable-spinlocks --disable-atomics \
 --without-zlib --disable-largefile --without-llvm \
 --without-pam --disable-largefile --without-zlib --with-openssl=no \
 --without-readline --without-icu \
 ${PGDEBUG}"

#  --cache-file=${PGROOT}/config.cache.wasi
#  -lwasi-emulated-mman -lwasi-emulated-signal -lwasi-emulated-process-clocks"

        if \
         LDFLAGS="-lwasi-emulated-getpid -lwasi-emulated-mman -lwasi-emulated-signal -lwasi-emulated-process-clocks" \
         CFLAGS="$FLAGS -D_WASI_EMULATED_MMAN -D_WASI_EMULATED_SIGNAL -D_WASI_EMULATED_PROCESS_CLOCKS -D_WASI_EMULATED_GETPID" \
         ZIC=/usr/sbin/zic \
         CC=wasi-c \
         CXX=wasi-c++ \
         CONFIG_SITE=${PGDATA}/config.site \
         $CNF \
         --host=$(arch) --target=wasm32-unknown-wasi --with-template=wasi
        then
            echo configure ok
            make -j 1
        else
            echo configure failed
            exit 57
        fi

    else
        echo "Building $ARCHIVE (patched) from $PGSRC"
        . cibuild/pgbuild.sh
    fi
fi

