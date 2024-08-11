echo "============= link export : begin ==============="
emcc $EMCC_WEB -fPIC -sMAIN_MODULE=1 -O0 \
 -D__PYDK__=1 -DPREFIX=${PGROOT} \
 -sTOTAL_MEMORY=256MB -sSTACK_SIZE=4MB -sALLOW_TABLE_GROWTH -sALLOW_MEMORY_GROWTH -sGLOBAL_BASE=${CMA_MB}MB \
 -sERROR_ON_UNDEFINED_SYMBOLS -sASSERTIONS=0 \
 -lnodefs.js -lidbfs.js \
 -sEXPORTED_RUNTIME_METHODS=FS,setValue,getValue,UTF8ToString,stringToNewUTF8,stringToUTF8OnStack,ccall,cwrap,callMain \
 --preload-file ${PGROOT}/share/postgresql@${PGROOT}/share/postgresql \
 --preload-file ${PGROOT}/lib/postgresql@${PGROOT}/lib/postgresql \
 --preload-file ${PGROOT}/password@${PGROOT}/password \
 --preload-file pgpass@${PGROOT}/pgpass \
 --preload-file placeholder@${PGROOT}/bin/postgres \
 --preload-file placeholder@${PGROOT}/bin/initdb \
 -o postgres.html $PG_O $PG_L || exit 14

echo "FULL:" > ${WORKSPACE}/build/sizes.log
du -hs postgres.wasm >> ${WORKSPACE}/build/sizes.log
echo >> ${WORKSPACE}/build/sizes.log


echo "getting wasm exports lists"
wasm-objdump -x $(realpath postgres.wasm) > ${WORKSPACE}/patches/dump.wasm-objdump

pushd ${WORKSPACE}
    echo "getting postgres exports lists"
    cat $(find build/postgres -type f |grep /exports) \
     | grep -v ^\ local \
     | grep -v ^{\ global \
     | sort | uniq > ${WORKSPACE}/patches/dump.postgres

    OBJDUMP=patches/dump.wasm-objdump PGDUMP=patches/dump.postgres \
     python3 cibuild/getsyms.py exports > patches/exports.pglite
popd

echo "============= link export : end ==============="

