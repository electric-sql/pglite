
BUILD=build
mkdir -p ${BUILD}



pushd ${BUILD}
    if [ -d postgis-3.5.0 ]
    then
        echo -n
    else
        [ -f postgis-3.5.0.tar.gz ] || wget -c https://download.osgeo.org/postgis/source/postgis-3.5.0.tar.gz
        tar xfz postgis-3.5.0.tar.gz && rm postgis-3.5.0.tar.gz
        pushd postgis-3.5.0
            patch -p1 < ${WORKSPACE}/extra/postgis.diff
        popd
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

pushd ${BUILD}/postgis-3.5.0

    cat > config.site <<END
ac_cv_exeext=.cjs
POSTGIS_PROJ_VERSION=94
ICONV_CFLAGS=
ICONV_LDFLAGS=
with_libiconv=$PREFIX
ac_cv_func_iconv=no
ac_cv_func_iconvctl=no
cross_compiling=yes
ac_cv_lib_proj_pj_get_release=no
ac_cv_header_proj_api_h=no
END

    # --without-raster --without-topology --without-address-standardizer
    # --without-raster => --with-gdalconfig=
    # --with-gdalconfig=$PREFIX/bin/gdal-config
    CONFIG_SITE=config.site emconfigure ./configure \
        --without-raster --without-topology --without-address-standardizer \
     --with-gdalconfig=$PREFIX/bin/gdal-config \
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
    sed -i 's/PGSQL_FE_LDFLAGS=-L/PGSQL_FE_LDFLAGS=-O0 -g3 -sERROR_ON_UNDEFINED_SYMBOLS=0 -L/g' loader/Makefile
    #DEFAULT_LIBRARY_FUNCS_TO_INCLUDE="_emscripten_memcpy_js"
    EMCC_CFLAGS="-O0 -g3 -sERROR_ON_UNDEFINED_SYMBOLS=0 -Wno-unused-function -lpng -ljpeg" emmake make
    # /opt/python-wasm-sdk/devices/emsdk/usr/lib/libgeos.a
    rm postgis/postgis-3.s*
    PATH=/tmp/pglite/bin:$PATH PG_LINK="em++ $PREFIX/lib/libgeos.a $EMSDK/upstream/emscripten/cache/sysroot/lib/wasm32-emscripten/pic/libsqlite3.a"  emmake make install
    rm $PGROOT/share/postgresql/extension/postgis*.sql
    cp ./extensions/postgis/sql/postgis--3.5.0.sql $PGROOT/share/postgresql/extension/postgis--3.5.0.sql

popd

