    if [ -d pglite ]
    then
        # work tree
        pushd pglite/packages/pglite
        PGLITE=$(pwd)
    else
        # release tree
        pushd packages/pglite
        PGLITE=$(pwd)
    fi

    # not used for now, everything in PGROOT is to be bundled
    cat > $PGLITE/release/share.js <<END

    function loadPgShare(module, require) {
        console.warn("share.js: loadPgShare");
    }

    export default loadPgShare;
END

    # copy wasm web prebuilt artifacts to release folder
    # TODO: get them from web for nosdk systems.
    if $CI
    then
        cp /tmp/web/repl/postgres.{js,data,wasm} $PGLITE/release/
        cp /tmp/web/repl/libecpg.so $PGLITE/release/postgres.so
    else
        cp ${WEBROOT}/postgres.{js,data,wasm} ${PGLITE}/release/
        cp ${WEBROOT}/libecpg.so ${PGLITE}/release/postgres.so
    fi
    touch $PGLITE/release/share.data


    # this is the ES6 wasm module loader from emscripten.
    mv $PGLITE/release/postgres.js $PGLITE/release/pgbuild.js


    # use a javascript wasm module loader with a thin api for argv/env setup
    cat ${GITHUB_WORKSPACE}/patches/pgbuild.js > $PGLITE/release/postgres.js


    npm install

    # CI does not use npm for building pg, so call the typescript build
    # part from here
    if $CI
    then
        npm run build:js
        mkdir -p ${WEBROOT}/node_modules/@electric-sql/pglite
        cp -r ${PGLITE}/{LICENSE,package.json,README.md} ${PGLITE}/dist ${WEBROOT}/node_modules/@electric-sql/pglite/
        pushd ${WEBROOT}
        zip /tmp/sdk/pglite.zip -r node_modules
        popd
    fi

    popd


