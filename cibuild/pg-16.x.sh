ARCHIVE=postgresql-${PGVERSION}.tar.bz2

if [ -f postgresql/postgresql-${PGVERSION}.patched ]
then
    echo version already selected and patch stage already done
else
    [ -f ${ARCHIVE} ] || wget -q -c https://ftp.postgresql.org/pub/source/v${PGVERSION}/${ARCHIVE}

    tar xfj ${ARCHIVE}

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
                cat ../patches/$patchdir/*.diff | patch -p1 || exit 18
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

echo "Building $ARCHIVE (patched) from $PGSRC"

. cibuild/pgbuild.sh

