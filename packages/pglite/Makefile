.PHONY: debug-build debug-datadir build datadir

build:
	EMCC_CFLAGS="-Wl,--allow-undefined" \
	emconfigure ./configure CFLAGS='-O3' \
		--without-readline \
		--without-zlib \
		--disable-thread-safety \
		--disable-spinlocks \
		--with-system-tzdata=/usr/share/zoneinfo
	EMCC_CFLAGS="-s ERROR_ON_UNDEFINED_SYMBOLS=0 -s WARN_ON_UNDEFINED_SYMBOLS=0 -s TOTAL_MEMORY=65536000 -s EMULATE_FUNCTION_POINTER_CASTS=1 -s MODULARIZE=1 -s EXPORT_ES6=1 -s EXPORTED_RUNTIME_METHODS='FS'" \
		emmake make -C src/backend MAKELEVEL=0
	mkdir -p ../packages/pglite/release
	cp src/backend/postgres ../packages/pglite/release/postgres.js
	cp src/backend/postgres.wasm ../packages/pglite/release/postgres.wasm
	cd ../packages/pglite/ && node scripts/modify-postrges-js.js

sharedir:
	mkdir -p tmp_install
	DESTDIR="$(abspath tmp_install)" \
	EMCC_CFLAGS="-s ERROR_ON_UNDEFINED_SYMBOLS=0 -s WARN_ON_UNDEFINED_SYMBOLS=0 -s TOTAL_MEMORY=65536000 -s EMULATE_FUNCTION_POINTER_CASTS=1 -s MODULARIZE=1 -s EXPORT_ES6=1 -s EXPORTED_RUNTIME_METHODS='FS'" \
		emmake make MAKELEVEL=0 -C src/backend/ install
	node ../packages/pglite/scripts/modify-share.js
	cd ../packages/pglite/release && \
	`em-config EMSCRIPTEN_ROOT`/tools/file_packager share.data --preload ../../../postgres/tmp_install/usr/local/pgsql/share@/usr/local/pgsql/share --js-output=share.js --export-name=ModuleBase
	cd ../packages/pglite/ && node scripts/modify-share-js.js

build-debug:
	EMCC_CFLAGS="-Wl,--allow-undefined" \
	emconfigure ./configure CFLAGS='-Oz' \
		--without-readline \
		--without-zlib \
		--disable-thread-safety \
		--disable-spinlocks \
		--with-system-tzdata=/usr/share/zoneinfo
	EMCC_CFLAGS="-s ERROR_ON_UNDEFINED_SYMBOLS=0 -s WARN_ON_UNDEFINED_SYMBOLS=0 -s TOTAL_MEMORY=65536000 -s EMULATE_FUNCTION_POINTER_CASTS=1 -s MODULARIZE=1 -s EXPORT_ES6=1 -s EXPORTED_RUNTIME_METHODS='FS' -s ASSERTIONS=2 -s SAFE_HEAP=1" \
		emmake make -C src/backend MAKELEVEL=0
	mkdir -p ../packages/pglite/release
	cp src/backend/postgres ../packages/pglite/release/postgres.js
	cp src/backend/postgres.wasm ../packages/pglite/release/postgres.wasm
	cd ../packages/pglite/ && node scripts/modify-postrges-js.js

sharedir-debug:
	mkdir -p tmp_install
	DESTDIR="$(abspath tmp_install)" \
	EMCC_CFLAGS="-s ERROR_ON_UNDEFINED_SYMBOLS=0 -s WARN_ON_UNDEFINED_SYMBOLS=0 -s TOTAL_MEMORY=65536000 -s EMULATE_FUNCTION_POINTER_CASTS=1 -s MODULARIZE=1 -s EXPORT_ES6=1 -s EXPORTED_RUNTIME_METHODS='FS' -s ASSERTIONS=2 -s SAFE_HEAP=1" \
		emmake make MAKELEVEL=0 -C src/backend/ install
	node ../packages/pglite/scripts/modify-share.js
	cd ../packages/pglite/release && \
	`em-config EMSCRIPTEN_ROOT`/tools/file_packager share.data --preload ../../../postgres/tmp_install/usr/local/pgsql/share@/usr/local/pgsql/share --js-output=share.js --export-name=ModuleBase
	cd ../packages/pglite/ && node scripts/modify-share-js.js
