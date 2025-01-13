if [ -f postgresql/postgresql-${PG_VERSION}.patched ]
then
    echo version already selected and patch stage already done
else
    git clone --no-tags --depth 1 --single-branch --branch ${PG_VERSION} https://github.com/electric-sql/postgres-pglite postgresql-${PG_VERSION}

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
                for one in ../patches/$patchdir/*.diff
                do
                    if cat $one | patch -p1
                    then
                        echo applied $one
                    else
                        echo "

Fatal: failed to apply patch : $one
"
                        exit 30
                    fi
                done
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
    echo "Building $ARCHIVE (patched) from $PGSRC WASI=$WASI"
    . cibuild/pgbuild.sh
fi

