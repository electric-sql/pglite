ARG PGLITE_BUILDER_IMAGE=electricsql/pglite-builder:3.1.74-7
FROM ${PGLITE_BUILDER_IMAGE}

ARG BINARYEN_COMMIT=52bc45fc34ec6868400216074744147e9d922685
ARG EMSDK_VER=3.1.74
ARG NODE22_VERSION=22.13.0
ARG NODE24_VERSION=24.15.0
ARG PNPM_VERSION=9.7.0
ARG VITEST_VERSION=2.1.2
ARG TARGETARCH

RUN apt-get update \
    && apt-get install -y --no-install-recommends cmake git ninja-build \
    && rm -rf /var/lib/apt/lists/*

RUN git clone --filter=blob:none --no-checkout \
    https://github.com/WebAssembly/binaryen.git /opt/binaryen \
    && git -C /opt/binaryen checkout "${BINARYEN_COMMIT}" \
    && cmake -S /opt/binaryen -B /opt/binaryen/build -G Ninja \
      -DCMAKE_BUILD_TYPE=Release \
      -DBUILD_TESTS=OFF \
      -DBUILD_TOOLS=ON \
      -DBUILD_LLVM_DWARF=ON \
    && cmake --build /opt/binaryen/build \
      --target wasm-as wasm-dis wasm-opt \
      --parallel \
    && install -m 0755 /opt/binaryen/build/bin/wasm-as /usr/local/bin/wasm-as \
    && install -m 0755 /opt/binaryen/build/bin/wasm-dis /usr/local/bin/wasm-dis \
    && install -m 0755 /opt/binaryen/build/bin/wasm-opt /usr/local/bin/wasm-opt \
    && install -m 0755 /opt/binaryen/build/lib/libbinaryen.so /usr/local/lib/libbinaryen.so \
    && ldconfig

COPY transformer/pglite-wasm-multi-memory.cpp /opt/binaryen/src/tools/

RUN printf '\nbinaryen_add_executable(pglite-wasm-multi-memory pglite-wasm-multi-memory.cpp)\n' \
      >> /opt/binaryen/src/tools/CMakeLists.txt \
    && cmake -S /opt/binaryen -B /opt/binaryen/build -G Ninja \
    && cmake --build /opt/binaryen/build \
      --target pglite-wasm-multi-memory \
      --parallel \
    && install -m 0755 \
      /opt/binaryen/build/bin/pglite-wasm-multi-memory \
      /usr/local/bin/pglite-wasm-multi-memory

# The postmaster's dynamic side modules import the two additional PGlite
# memories. Keep the pinned Emscripten loader change inside the build image so
# every generated main-module glue file applies the same validation and import
# contract.
COPY emscripten/pglite-library-dylink.patch /tmp/pglite-library-dylink.patch
RUN patch --directory=/emsdk/upstream/emscripten --strip=1 \
      < /tmp/pglite-library-dylink.patch \
    && rm /tmp/pglite-library-dylink.patch

RUN case "${TARGETARCH}" in \
      amd64) node_arch=x64 ;; \
      arm64) node_arch=arm64 ;; \
      *) echo "unsupported TARGETARCH=${TARGETARCH}" >&2; exit 1 ;; \
    esac \
    && curl -fsSLo /tmp/node22.tar.xz \
      "https://nodejs.org/dist/v${NODE22_VERSION}/node-v${NODE22_VERSION}-linux-${node_arch}.tar.xz" \
    && mkdir -p /opt/node22 \
    && tar -xJf /tmp/node22.tar.xz --strip-components=1 -C /opt/node22 \
    && curl -fsSLo /tmp/node24.tar.xz \
      "https://nodejs.org/dist/v${NODE24_VERSION}/node-v${NODE24_VERSION}-linux-${node_arch}.tar.xz" \
    && mkdir -p /opt/node24 \
    && tar -xJf /tmp/node24.tar.xz --strip-components=1 -C /opt/node24 \
    && rm /tmp/node22.tar.xz /tmp/node24.tar.xz \
    && ln -s "$(command -v node)" /usr/local/bin/node20 \
    && ln -s /opt/node22/bin/node /usr/local/bin/node22 \
    && ln -s /opt/node24/bin/node /usr/local/bin/node24 \
    && /opt/node22/bin/npm install --global --prefix /opt/node22 \
      "pnpm@${PNPM_VERSION}" "vitest@${VITEST_VERSION}"

# Keep host regression/TAP tooling in the image, late enough that changing it
# does not invalidate the expensive native Binaryen build above.
RUN apt-get update \
    && apt-get install -y --no-install-recommends jq libipc-run-perl \
    && rm -rf /var/lib/apt/lists/*

# Publish the deterministic side-module transform and audit pipeline in the
# pinned image. Extension authors need only Docker plus their normal Emscripten
# SIDE_MODULE; Binaryen, Node, and the ABI validator remain image-owned.
COPY side-modules/audit-side-module.mjs \
  /opt/pglite-multi-memory/bin/audit-side-module.mjs
COPY side-modules/transform-side-module.sh \
  /opt/pglite-multi-memory/bin/pglite-transform-side-module
RUN chmod 0755 \
      /opt/pglite-multi-memory/bin/audit-side-module.mjs \
      /opt/pglite-multi-memory/bin/pglite-transform-side-module \
    && ln -s /opt/pglite-multi-memory/bin/pglite-transform-side-module \
      /usr/local/bin/pglite-transform-side-module

LABEL org.opencontainers.image.title="PGlite multi-memory build and test tools" \
      org.opencontainers.image.binaryen-revision="${BINARYEN_COMMIT}" \
      org.opencontainers.image.emscripten-version="${EMSDK_VER}" \
      org.opencontainers.image.node22-version="${NODE22_VERSION}" \
      org.opencontainers.image.node24-version="${NODE24_VERSION}" \
      org.opencontainers.image.pnpm-version="${PNPM_VERSION}" \
      org.opencontainers.image.vitest-version="${VITEST_VERSION}"
