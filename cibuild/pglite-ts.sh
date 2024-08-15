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

    pnpm install
    pushd  $PGLITE/../repl
        pnpm install
        pnpm run build:react && pnpm run build:webcomp
    popd

    mkdir -p $PGLITE/release
    rm $PGLITE/release/* 2>/dev/null

    # copy packed extensions
    cp ${WEBROOT}/*.tar.gz ${PGLITE}/release/

    # copy wasm web prebuilt artifacts to release folder
    # TODO: get them from web for nosdk systems.

    cp ${WEBROOT}/postgres.{js,data,wasm} ${PGLITE}/release/

    # unused right now
    # touch $PGLITE/release/share.data


    # debug CI does not use pnpm/npm for building pg, so call the typescript build
    # part from here
    if $CI
    then
        pnpm run build:js
        mkdir -p /tmp/sdk
        pnpm pack
        packed=$(echo -n electric-sql-pglite-*.tgz)
        mv $packed /tmp/sdk/pg${PGVERSION}-${packed}

        # for repl demo
        mkdir -p /tmp/web/pglite
        cp -r ${PGLITE}/dist /tmp/web/pglite/
        cp -r ${PGLITE}/examples /tmp/web/pglite/

        for dir in /tmp/web /tmp/web/pglite/examples
        do
            pushd "$dir"
            cp ${PGLITE}/dist/postgres.data ./
            popd
        done

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

