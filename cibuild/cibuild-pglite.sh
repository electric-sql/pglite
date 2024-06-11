    if [ -d pglite ]
    then
        # work tree
        pushd pglite/packages/pglite
        PGLITE=$(pwd)
    else
        # release tree
        pushd ../packages/pglite
        PGLITE=$(pwd)
    fi

    # not used for now, everything in PGROOT will be bundled
    cat > $PGLITE/release/share.js <<END

    function loadPgShare(module, require) {
        console.warn("share.js: loadPgShare");
    }

    export default loadPgShare;
END

    npm install
    npm run build
    popd

    if $CI
    then
        cp /tmp/sdk/postgres.{js,data,wasm} $PGLITE/release/
        cp /tmp/sdk/libecpg.so $PGLITE/release/postgres.so
    else
        cp ${WEBROOT}/postgres.{js,data,wasm} pglite/packages/pglite/release/
        cp ${WEBROOT}/libecpg.so pglite/packages/pglite/release/postgres.so
    fi
    mv $PGLITE/release/postgres.js $PGLITE/release/pgbuild.js

    cat pgbuild.js > $PGLITE/release/postgres.js

