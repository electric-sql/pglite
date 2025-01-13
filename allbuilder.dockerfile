ARG PG_VERSION=git
ARG SDK_VERSION=3.1.74.2bi
FROM electricsql/pglite-builder:${PG_VERSION}_${SDK_VERSION}

ENV NODE_VERSION=20.18.1
RUN apt update && apt install -y curl git build-essential libreadline-dev zlib1g-dev bison flex file
RUN curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
ENV NVM_DIR=/root/.nvm
RUN . "$NVM_DIR/nvm.sh" && nvm install ${NODE_VERSION}
RUN . "$NVM_DIR/nvm.sh" && nvm use v${NODE_VERSION}
RUN . "$NVM_DIR/nvm.sh" && nvm alias default v${NODE_VERSION}
ENV PATH="/root/.nvm/versions/node/v${NODE_VERSION}/bin/:${PATH}"
RUN node --version
RUN npm --version
RUN corepack enable pnpm

# RUN wget -qO- https://get.pnpm.io/install.sh | ENV="$HOME/.bashrc" SHELL="$(which bash)" bash -

WORKDIR /workspace