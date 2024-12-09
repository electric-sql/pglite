if [ -f postgresql/postgresql-${PG_VERSION}.patched ]
then
    echo version already selected and patch stage already done
else
    git clone --no-tags --depth 1 --single-branch --branch REL_16_STABLE https://github.com/electric-sql/postgres-pglite postgresql-${PG_VERSION}

    if pushd postgresql-${PG_VERSION}
    then
            echo
        > ./src/template/emscripten
        > ./src/include/port/emscripten.h
        > ./src/makefiles/Makefile.emscripten
        for patchdir in \
            postgresql-debug \
            postgresql-emscripten \
            postgresql-pglite
        do
            if [ -d ../patches/$patchdir ]
            then
                cat ../patches/$patchdir/*.diff | patch -p1 || exit 20
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
        #
        echo "see pglite-build CI"
    else
        echo "Building $ARCHIVE (patched) from $PGSRC"
        . cibuild/pgbuild.sh
    fi
fi

