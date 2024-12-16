ARG PG_VERSION=git
ARG SDK_VERSION=3.1.72.3bi
FROM electricsql/pglite-builder:${PG_VERSION}_${SDK_VERSION}

WORKDIR /workspace

COPY . .

RUN pnpm install
RUN pnpm wasm:build-no-docker
RUN pnpm ts:build