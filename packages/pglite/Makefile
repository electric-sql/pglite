.PHONY: debug-build debug-datadir build datadir

build-configure:
	EMCC_CFLAGS="-Wl,--allow-undefined" \
	emconfigure ./configure CFLAGS='-O2' \
		--without-readline \
		--without-zlib \
		--disable-thread-safety \
		--disable-spinlocks \
		--with-system-tzdata=/usr/share/zoneinfo

build:
	EMCC_CFLAGS="--profiling -sMAIN_MODULE=2 -sALLOW_MEMORY_GROWTH=1 -sERROR_ON_UNDEFINED_SYMBOLS=0 -sWARN_ON_UNDEFINED_SYMBOLS=0 -sTOTAL_MEMORY=65536000 -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORTED_FUNCTIONS=@/Users/samwillis/Code/pglite/packages/pglite/exports.txt -sEXPORTED_RUNTIME_METHODS=ccall,cwrap,FS" \
		emmake make -C src/backend MAKELEVEL=0
	mkdir -p ../packages/pglite/release
	cp src/backend/postgres ../packages/pglite/release/postgres.js
	cp src/backend/postgres.wasm ../packages/pglite/release/postgres.wasm
	cd ../packages/pglite/ && node scripts/modify-postgres-js.js

sharedir:
	mkdir -p tmp_install
	DESTDIR="$(abspath tmp_install)" \
	EMCC_CFLAGS="-sMAIN_MODULE=2 -sERROR_ON_UNDEFINED_SYMBOLS=0 -sWARN_ON_UNDEFINED_SYMBOLS=0 -sTOTAL_MEMORY=65536000 -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORTED_RUNTIME_METHODS='FS'" \
		emmake make MAKELEVEL=0 -C src/backend/ install
	node ../packages/pglite/scripts/modify-share.js
	cd ../packages/pglite/release && \
	`em-config EMSCRIPTEN_ROOT`/tools/file_packager share.data --preload ../../../postgres/tmp_install/usr/local/pgsql/share@/usr/local/pgsql/share --js-output=share.js --export-name=ModuleBase
	cd ../packages/pglite/ && node scripts/modify-share-js.js

build-plpgsql:
	EMCC_CFLAGS="--profiling --emit-symbol-map -sSIDE_MODULE=1 -sERROR_ON_UNDEFINED_SYMBOLS=0 -sWARN_ON_UNDEFINED_SYMBOLS=0 -sTOTAL_MEMORY=65536000 -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORTED_RUNTIME_METHODS='FS'" \
		emmake make -C src/pl/plpgsql MAKELEVEL=0
	mkdir -p tmp_install/plpgsql/share/extension
	mkdir -p tmp_install/plpgsql/lib
	cp src/pl/plpgsql/src/plpgsql.so tmp_install/plpgsql/lib/plpgsql.so
	cp src/pl/plpgsql/src/plpgsql.control tmp_install/plpgsql/share/extension/plpgsql.control
	cp src/pl/plpgsql/src/plpgsql--1.0.sql tmp_install/plpgsql/share/extension/plpgsql--1.0.sql
	cd ../packages/pglite/release && \
	`em-config EMSCRIPTEN_ROOT`/tools/file_packager plpgsql.data --preload ../../../postgres/tmp_install/plpgsql@/usr/local/pgsql --js-output=plpgsql.js --export-name=ModuleBase
	cd ../packages/pglite/ && node scripts/modify-data-js.js ../release/plpgsql.js
