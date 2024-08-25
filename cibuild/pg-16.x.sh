ARCHIVE=postgresql-${PG_VERSION}.tar.gz

if echo ${PG_VERSION} | grep -q 16.5
then
    PG_PREREL=true
    ARCHIVE_URL=https://github.com/postgres/postgres/archive/refs/tags/REL_16_5.tar.gz
else
    PG_PREREL=false
    ARCHIVE_URL=https://ftp.postgresql.org/pub/source/v${PG_VERSION}/${ARCHIVE}
fi


if [ -f postgresql/postgresql-${PG_VERSION}.patched ]
then
    echo "

    Version ${PG_VERSION} already selected and patch stage already done

"
else
    [ -f ${ARCHIVE} ] || wget -q -c -O${ARCHIVE} ${ARCHIVE_URL}

    tar xfz ${ARCHIVE}

    if $PG_PREREL
    then
        ln -sf $(pwd)/postgres-REL_16_? postgresql-${PG_VERSION}
    fi

    if pushd postgresql-${PG_VERSION}
    then
            echo
        > ./src/template/emscripten
        > ./src/include/port/emscripten.h
        > ./src/makefiles/Makefile.emscripten
        for patchdir in \
            postgresql-emscripten \
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

    rm postgresql 2>/dev/null
    ln -s postgresql-${PG_VERSION} postgresql

fi

export PGSRC=$(realpath postgresql-${PG_VERSION})

if [ -f ${PGROOT}/pg.installed ]
then
    echo "
        skipping pg build, using previous install from ${PGROOT}

"
else
    echo "Building $ARCHIVE (patched) from $PGSRC"
    . cibuild/pgbuild.sh
fi

