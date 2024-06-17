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


    npm install

    mkdir $PGLITE/release || rm $PGLITE/release/*

    cp ${GITHUB_WORKSPACE}/patches/postgres.d.ts ${PGLITE}/release/

    # copy wasm web prebuilt artifacts to release folder
    # TODO: get them from web for nosdk systems.
    if $CI
    then
        cp -vf /tmp/web/repl/postgres.{js,data,wasm} $PGLITE/release/
        cp -vf /tmp/web/repl/libecpg.so $PGLITE/release/postgres.so
    else
        cp ${WEBROOT}/postgres.{js,data,wasm} ${PGLITE}/release/
        cp ${WEBROOT}/libecpg.so ${PGLITE}/release/postgres.so
    fi

    # unused right now
    # touch $PGLITE/release/share.data



    if ${DEV:-false}
    then
        echo "




        ===============================  dev test mode ===========================







"
        # this is the ES6 wasm module loader from emscripten.
        cp $PGLITE/release/postgres.js $PGLITE/release/pgbuild.js
        # use a javascript wasm module loader with a thin api for tests
        cat ${GITHUB_WORKSPACE}/patches/pgbuild.js > $PGLITE/release/postgres.js
    else
        echo "using emscripten es6->ts interface"
    fi


    # CI does not use npm for building pg, so call the typescript build
    # part from here
    if $CI
    then
        npm run build:js
        if $CI
        then
            mkdir /tmp/sdk -p
            npm pack
            packed=$(echo -n electric-sql-pglite-*.tgz)
            mv $packed /tmp/sdk/pg${PGVERSION}-${packed}
        else
            mkdir -p ${WEBROOT}/node_modules/@electric-sql/pglite
            cp -r ${PGLITE}/{../../LICENSE,package.json,README.md} ${PGLITE}/dist ${WEBROOT}/node_modules/@electric-sql/pglite/
            pushd ${WEBROOT}
            zip /tmp/sdk/pglite.zip -q -r node_modules
            popd
        fi
    fi

    popd


