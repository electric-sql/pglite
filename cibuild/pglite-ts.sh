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

    mkdir -p $PGLITE/release
    rm $PGLITE/release/* 2>/dev/null

    # copy packed extensions
    cp ${WEBROOT}/*.tar.gz ${PGLITE}/release/

    # copy wasm web prebuilt artifacts to release folder
    # TODO: get them from web for nosdk systems.
    if $CI
    then
        cp -vf /tmp/web/postgres.{js,data,wasm} $PGLITE/release/
        cp -vf /tmp/web/libecpg.so $PGLITE/release/postgres.so
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

    # debug CI does not use pnpm/npm for building pg, so call the typescript build
    # part from here
    if $CI
    then
        npm run build:js
        mkdir -p /tmp/sdk
        npm pack
        packed=$(echo -n electric-sql-pglite-*.tgz)
        mv $packed /tmp/sdk/pg${PGVERSION}-${packed}

        # for repl demo
        mkdir -p /tmp/web/pglite
        cp -r ${PGLITE}/dist /tmp/web/pglite/
        cp -r ${PGLITE}/examples /tmp/web/pglite/
        pushd /tmp/web/
        ln -s ../dist/postgres.data
        popd
        # link files for xterm based repl
        ln ${WEBROOT}/dist/postgres.* ${WEBROOT}/ || echo pass

            echo "<html>
            <body>
                <ul>
                    <li><a href=./pglite/examples/repl.html>PGlite REPL (in-memory)</a></li>
                    <li><a href=./pglite/examples/repl-idb.html>PGlite REPL (indexedDB)</a></li>
                    <li><a href=./pglite/examples/notify.html>list/notify test</a></li>
                    <li><a href=./pglite/examples/index.html>All PGlite Examples</a></li>
                    <li><a href=./pglite/benchmark/index.html>Benchmarks</a> / <a href=./pglite/benchmark/rtt.html>RTT Benchmarks</a></li>
                    <li><a href=./postgres.html>Postgres xterm REPL</a></li>
                </ul>
            </body>
            </html>" > ${WEBROOT}/index.html

    else
        mkdir -p ${WEBROOT}/node_modules/@electric-sql/pglite
        cp -r ${PGLITE}/{../../LICENSE,package.json,README.md} ${PGLITE}/dist ${WEBROOT}/node_modules/@electric-sql/pglite/
        pushd ${WEBROOT}
        zip /tmp/sdk/pglite.zip -q -r node_modules
        popd
    fi

    popd

