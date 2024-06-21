source /emsdk/emsdk_env.sh

cd /pglite/packages/pglite
pnpm run build:clean
pnpm run build
pnpm run test

# hold the container open
tail -f /dev/null 