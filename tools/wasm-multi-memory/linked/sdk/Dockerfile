ARG PGLITE_BASE_IMAGE=pglite-multi-memory-shared-tools:3.1.74-6
FROM ${PGLITE_BASE_IMAGE}
COPY linked/sdk/emscripten.patch /tmp/pglite-linked.patch
RUN patch -d /emsdk/upstream/emscripten -p1 </tmp/pglite-linked.patch
WORKDIR /tmp/linked-sdk
COPY --chmod=755 extensions/package-extension.mjs /opt/pglite-multi-memory/bin/package-extension.mjs
COPY --chmod=755 extensions/generate-wrapper.mjs /opt/pglite-multi-memory/bin/generate-extension-wrapper.mjs
COPY linked/compile.sh linked/lower.cpp linked/version-loops.cpp linked/pair-loads.h tools/wasm-multi-memory/linked/
COPY linked/sdk/install.sh linked/sdk/provider-v1.py linked/sdk/package.sh linked/sdk/transform.sh linked/sdk/runtime-modules.sh tools/wasm-multi-memory/linked/sdk/
COPY private-return-exports.txt /tmp/linked-sdk/tools/wasm-multi-memory/
RUN bash tools/wasm-multi-memory/linked/sdk/install.sh && cd /tmp && rm -rf /tmp/linked-sdk
WORKDIR /work
