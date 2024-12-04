
PG_VERSION=16.4
PG_PREREL=false
export PGSRC=$(realpath postgresql-${PG_VERSION})

if [ -d postgresql-${PG_VERSION} ]; then
    echo "postgresql-${PG_VERSION} exists."
else
    git clone --single-branch --branch=tudor/test-postgres-pglite-16.4 https://github.com/electric-sql/postgres-pglite.git postgresql-${PG_VERSION} || exit 29
fi

# these are files that shadow original portion of pg core, with minimal changes
# to original code
# some may be included multiple time
CC_PGLITE="-DPATCH_MAIN=${PGSRC}/src/pglite-extra/pg_main.c ${CC_PGLITE}"
CC_PGLITE="-DPATCH_LOOP=${PGSRC}/src/pglite-extra/interactive_one.c ${CC_PGLITE}"
CC_PGLITE="-DPATCH_PLUGIN=${PGSRC}/src/pglite-extra/pg_plugin.h ${CC_PGLITE}"

export CC_PGLITE

rm postgresql 2>/dev/null
ln -s postgresql-${PG_VERSION} postgresql

echo "Building postgresql-${PG_VERSION} in folder $PGSRC"
. cibuild/pgbuild.sh