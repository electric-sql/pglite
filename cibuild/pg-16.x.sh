if echo ${PGVERSION} | grep -q 16.4
then
    PG_PREREL=true
    ARCHIVE_URL=https://github.com/postgres/postgres/archive/refs/tags/REL_16_4.tar.gz
else
    PG_PREREL=false
    ARCHIVE_URL=https://ftp.postgresql.org/pub/source/v${PGVERSION}/${ARCHIVE}
fi

ARCHIVE=postgresql-${PGVERSION}.tar.gz

if [ -f postgresql/postgresql-${PGVERSION}.patched ]
then
    echo "

    Version ${PGVERSION} already selected and patch stage already done

"
else
    [ -f ${ARCHIVE} ] || wget -q -c -O${ARCHIVE} ${ARCHIVE_URL}

    tar xfz ${ARCHIVE}

    if $PG_PREREL
    then
        ln -sf $(pwd)/postgres-REL_16_? postgresql-${PGVERSION}
    fi

    if pushd postgresql-${PGVERSION}
    then
            echo
        > ./src/template/emscripten
        > ./src/include/port/emscripten.h
        > ./src/makefiles/Makefile.emscripten
        for patchdir in \
            postgresql-emscripten \
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
    echo "
        skipping pg build, using previous install from ${PGROOT}

"
else
    echo "Building $ARCHIVE (patched) from $PGSRC"
    . cibuild/pgbuild.sh
fi

