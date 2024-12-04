#!/bin/bash
echo "======== build-all.sh : $(pwd)             =========="
echo "======== Building all PGlite prerequisites =========="

# move copy of patches into dir
# not mounting them directly as lots of files are created
# cp -rf /opt/patches ./patches

apt update && apt install -y build-essential libreadline-dev zlib1g-dev bison flex git
export FLEX=`which flex`
$FLEX --version

. ./cibuild.sh

. ./cibuild.sh contrib
. ./cibuild.sh extra
. ./cibuild.sh node
. ./cibuild.sh linkweb
. ./cibuild.sh pglite-prep
