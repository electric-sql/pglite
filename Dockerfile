# Nice for windows. Autotools is borked completely by CRLFs anywhere.
# The separate stage prevents the files from being saved twice in the image.
FROM debian:bookworm-slim as pg_src
COPY postgres/ postgres/
RUN cd /postgres && find . -type f -exec sed -i 's/\r$//' {} +


FROM debian:bookworm-slim as build

# Apt Pkgs
RUN apt update && apt install -y build-essential flex bison git python3 curl


# Node / pnpm
ENV NODE_VERSION=20.5.0
ENV NODE_PACKAGE=node-v$NODE_VERSION-linux-x64
ENV NODE_HOME=/usr/local/bin/$NODE_PACKAGE
ENV PATH $NODE_HOME/bin:$PATH

RUN curl https://nodejs.org/dist/v$NODE_VERSION/$NODE_PACKAGE.tar.gz | tar -xzC /usr/local/bin/

RUN node -v
RUN npm i -g pnpm


# Emscripten SDK
RUN git clone https://github.com/emscripten-core/emsdk.git && \
    cd emsdk && \
    ./emsdk install 3.1.56 && \
    ./emsdk activate 3.1.56 

# JS Deps
WORKDIR /pglite
COPY package.json .
COPY pnpm-lock.yaml .
COPY pnpm-workspace.yaml .
COPY packages/ /pglite/packages/
COPY patches/ /pglite/patches/

WORKDIR /pglite/packages/pglite
RUN pnpm install


# Copy Postgres (big layer)
COPY --from=pg_src postgres/ /pglite/postgres/


# Loooong build
WORKDIR /pglite/packages/pglite/
RUN [ "/bin/bash", "-c", "source /emsdk/emsdk_env.sh && pnpm build:configure" ]
RUN [ "/bin/bash", "-c", "source /emsdk/emsdk_env.sh && pnpm build:wasm" ]
# RUN ["/bin/bash", "-c", "source /emsdk/emsdk_env.sh && pnpm build:sharedir"]
