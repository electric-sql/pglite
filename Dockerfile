FROM ubuntu:22.04 AS build_sdk

ARG PG_VERSION
ARG SDK_VERSION
ARG DEBUG=false
ARG OBJDUMP=true

ENV \
  PG_VERSION=$PG_VERSION \
  SDK_VERSION=$SDK_VERSION \
  SDKROOT=/opt/python-wasm-sdk \
  SYS_PYTHON=/usr/bin/python3 \
  DEBUG=$DEBUG \
  BUILDS=3.12 \
  EMFLAVOUR=latest

WORKDIR /workspace

# Install dependencies to build python-wasm-sdk
RUN \
  apt-get update &&\
  apt-get install -y \
  sudo patchelf git clang unzip autoconf libtool \
  libsqlite3-dev libffi-dev libssl-dev zlib1g-dev pkg-config \
  libncursesw5-dev python3 python3-pip \
  make build-essential wget lz4 bzip2 pv curl

# Download the python-wasm-sdk source for the given version
RUN git clone --depth 1 --branch ${SDK_VERSION} https://github.com/pygame-web/python-wasm-sdk.git

# Remove third party libraries that are not necessary for PGLite
RUN cd ./python-wasm-sdk/sources.wasm && rm assimp.sh bullet3.sh ode.sh

# Make python-wasm-sdk
RUN cd ./python-wasm-sdk && chmod +x ./python-wasm-sdk.sh && bash -c "./python-wasm-sdk.sh"


FROM ubuntu:22.04

ARG PG_VERSION
ARG SDK_VERSION
ARG DEBUG=false
ARG OBJDUMP=true

ENV \
  PG_VERSION=$PG_VERSION \
  SDK_VERSION=$SDK_VERSION \
  SDK_ARCHIVE=python3.12-wasm-sdk-Ubuntu-22.04.tar \
  SDKROOT=/opt/python-wasm-sdk \
  SYS_PYTHON=/usr/bin/python3 \
  PGROOT=/tmp/pglite \
  DEBUG=$DEBUG \
  OBJDUMP=$OBJDUMP

WORKDIR /workspace

COPY --from=0 /tmp/sdk /tmp/sdk

# Install dependencies to build postgres wasm
RUN \
  apt-get update &&\
  apt-get install -y lz4 wget pv bash curl bzip2 python3 build-essential &&\
  apt-get clean

# Extract SDK
RUN cd / && tar xvf /tmp/sdk/${SDK_ARCHIVE} | pv -p -l -s 24400 >/dev/null

# Clean up packaged SDK
RUN rm -rf /tmp/sdk

