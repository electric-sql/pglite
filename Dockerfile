FROM ubuntu:22.04

ARG PG_VERSION
ARG SDK_VERSION
ARG DEBUG=false

ENV \
  PGVERSION=$PG_VERSION \
  SDK_VERSION=$SDK_VERSION \
  SDK_ARCHIVE=python3.12-wasm-sdk-Ubuntu-22.04.tar.lz4 \
  SDKROOT=/opt/python-wasm-sdk \
  SYS_PYTHON=/usr/bin/python3 \
  PGROOT=/tmp/pglite \
  DEBUG=$DEBUG \
  OBJDUMP=true

WORKDIR /workspace

# Install dependencies
RUN \
  apt-get update &&\
  # to build python-wasm-sdk
  apt-get install -y sudo patchelf git clang libffi-dev libssl-dev zlib1g-dev pkg-config libncursesw5-dev python3-pip make &&\
  # to build postgres wasm
  apt-get install -y lz4 wget pv bash curl bzip2 python3 git build-essential &&\
  apt-get clean

# Download the python-wasm-sdk source for the given version
RUN git clone --depth 1 --branch ${SDK_VERSION} https://github.com/pygame-web/python-wasm-sdk.git

# Make python-wasm-sdk
RUN \
  cd ./python-wasm-sdk &&\
  BUILDS=3.12 EMFLAVOUR=latest bash ./python-wasm-sdk.sh