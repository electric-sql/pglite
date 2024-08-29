#!/bin/bash

mkdir -p build

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
popd



if which emcc
then
    echo -n
else
    reset;
    . /opt/python-wasm-sdk/wasm32-bi-emscripten-shell.sh
    export PGROOT=${PGROOT:-/tmp/pglite}
    export PATH=${PGROOT}/bin:$PATH
fi


pushd build/vector
    # path for wasm-shared already set to (pwd:pg build dir)/bin
    # OPTFLAGS="" turns off arch optim (sse/neon).
    PG_CONFIG=${PGROOT}/bin/pg_config emmake make OPTFLAGS="" install || exit 33
    cp sql/vector.sql sql/vector--0.7.3.sql ${PGROOT}/share/postgresql/extension
    rm ${PGROOT}/share/postgresql/extension/vector--?.?.?--?.?.?.sql ${PGROOT}/share/postgresql/extension/vector.sql
popd

if ${CI:-false}
then
    echo -n
else
    python3 cibuild/pack_extension.py
fi

