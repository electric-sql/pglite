
if ${CI:-false}
then
    pushd build
        if [ -d postgis-3.4.2 ]
        then
            echo -n
        else
            wget -c https://download.osgeo.org/postgis/source/postgis-3.4.2.tar.gz
            tar xfz postgis-3.4.2.tar.gz
        fi
    popd
else
    reset;
    . /opt/python-wasm-sdk/wasm32-bi-emscripten-shell.sh
    export PATH=/tmp/pglite/bin:$PATH
    export PGROOT=${PGROOT:-/tmp/pglite}
fi

pushd build/postgis-3.4.2

    cat > config.site <<END
ac_cv_func_iconv=no
ac_cv_func_iconvctl=no
END

    # --without-raster --without-topology --without-address-standardizer
    # --without-raster => --with-gdalconfig=
    CONFIG_SITE=config.site emconfigure ./configure --without-raster \
     --without-gui --without-phony-revision --without-protobuf \
     --without-interrupt-tests --without-json \
     --without-libiconv --without-libiconv-prefix \
     --with-pgconfig=/tmp/pglite/bin/pg_config \
     --with-xml2config=$SDKROOT/devices/emsdk/usr/bin/xml2-config \
     --with-projdir=$SDKROOT/devices/emsdk/usr \
     --with-geosconfig=$SDKROOT/devices/emsdk/usr/bin/geos-config $@

    # workaround iconv
    mkdir -p loader/no/lib

    # or would fail on some frontend functions linking.
    sed -i 's/PGSQL_FE_LDFLAGS=-L/PGSQL_FE_LDFLAGS=-sERROR_ON_UNDEFINED_SYMBOLS=0 -L/g' loader/Makefile
    EMCC_CFLAGS="-sERROR_ON_UNDEFINED_SYMBOLS=0 -Wno-unused-function" emmake make install
    rm $PGROOT/share/postgresql/extension/postgis*.sql
    cp extensions/postgis_tiger_geocoder/sql/postgis_tiger_geocoder--TEMPLATED--TO--ANY.sql $PGROOT/share/postgresql/extension/postgis--3.4.2.sql

popd

if ${CI:-false}
then
    echo -n
else
    python3 cibuild/pack_extension.py
fi

