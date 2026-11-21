#!/usr/bin/env bash
set -euo pipefail
workspace=/build/workspace
export PATH="/opt/node22/bin:$PATH"
mkdir -p "$workspace"
tar -C /work --exclude=node_modules --exclude=dist --exclude=release --exclude=.out --exclude=.git \
  -cf - package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json packages tools tests LICENSE POSTGRES-LICENSE | tar -C "$workspace" -xf -
cd "$workspace"
pnpm install --prefer-offline --frozen-lockfile --store-dir /tmp/pnpm-store
