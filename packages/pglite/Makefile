.PHONY: debug-build debug-datadir build datadir

build-configure:
	EMCC_CFLAGS="-Wl,--allow-undefined" \
	emconfigure ./configure CFLAGS='-O2' \
		--without-readline \
		--without-zlib \
		--disable-thread-safety \
		--disable-spinlocks \
		--with-system-tzdata=/usr/share/zoneinfo
		--with-system-tzdata=/usr/share/zoneinfo

build:
	EMCC_CFLAGS="-s SIDE_MODULE=1 -sERROR_ON_UNDEFINED_SYMBOLS=0 -sWARN_ON_UNDEFINED_SYMBOLS=0 -sTOTAL_MEMORY=65536000 -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORTED_RUNTIME_METHODS='FS'" \
		emmake make -C src/pl/plpgsql MAKELEVEL=0

	EMCC_CFLAGS="-sALLOW_MEMORY_GROWTH=1 -sERROR_ON_UNDEFINED_SYMBOLS=0 -sWARN_ON_UNDEFINED_SYMBOLS=0 -sTOTAL_MEMORY=65536000 -sEMULATE_FUNCTION_POINTER_CASTS=1 -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORTED_FUNCTIONS=_main,_ExecProtocolMsg,_malloc,_free -sEXPORTED_RUNTIME_METHODS=ccall,cwrap,FS,stringToNewUTF8" \
		emmake make -C src/backend MAKELEVEL=0

	mkdir -p ../packages/pglite/release
	cp src/backend/postgres ../packages/pglite/release/postgres.js
	cp src/backend/postgres.wasm ../packages/pglite/release/postgres.wasm
	cd ../packages/pglite/ && node scripts/modify-postgres-js.js

sharedir:
	mkdir -p tmp_install
	
	DESTDIR="$(abspath tmp_install)" \
	EMCC_CFLAGS="-sERROR_ON_UNDEFINED_SYMBOLS=0 -sWARN_ON_UNDEFINED_SYMBOLS=0 -sTOTAL_MEMORY=65536000 -sEMULATE_FUNCTION_POINTER_CASTS=1 -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORTED_RUNTIME_METHODS='FS'" \
		emmake make MAKELEVEL=0 -C src/backend/ install

	DESTDIR="$(abspath tmp_install)" \
	EMCC_CFLAGS="-sERROR_ON_UNDEFINED_SYMBOLS=0 -sWARN_ON_UNDEFINED_SYMBOLS=0 -sTOTAL_MEMORY=65536000 -sEMULATE_FUNCTION_POINTER_CASTS=1 -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORTED_RUNTIME_METHODS='FS'" \
		emmake make MAKELEVEL=0 -C src/pl/plpgsql install

	rm tmp_install/usr/local/pgsql/share/*.sample
	rm tmp_install/usr/local/pgsql/share/timezonesets/*.txt
	node ../packages/pglite/scripts/modify-share.js
	cd ../packages/pglite/release && \
	`em-config EMSCRIPTEN_ROOT`/tools/file_packager share.data --preload ../../../postgres/tmp_install/usr/local/pgsql/share@/usr/local/pgsql/share --js-output=share.js --export-name=ModuleBase
	cd ../packages/pglite/ && node scripts/modify-share-js.js
