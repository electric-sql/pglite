pushd packages/pglite
    PGLITE=$(pwd)

    pnpm install --frozen-lockfile

    mkdir -p $PGLITE/release
    rm $PGLITE/release/* 2>/dev/null

    # copy packed extensions
    cp ${WEBROOT}/*.tar.gz ${PGLITE}/release/

    # copy wasm web prebuilt artifacts to release folder
    # TODO: get them from web for nosdk systems.

    cp ${WEBROOT}/postgres.{js,data,wasm} ${PGLITE}/release/

    # debug CI does not use pnpm/npm for building pg, so call the typescript build
    # part from here
    pnpm run build:js || exit 28

    mkdir -p /tmp/sdk
    pnpm pack || exit 31
    packed=$(echo -n electric-sql-pglite-*.tgz)

    mv $packed /tmp/sdk/pg${PG_VERSION}-${packed}

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

popd

