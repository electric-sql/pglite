#!/bin/bash
echo "======== build-all.sh : $(pwd)             =========="
echo "======== Building all PGlite prerequisites =========="

# move copy of patches into dir
# not mounting them directly as lots of files are created
cp -rf /opt/patches ./patches

. ./cibuild.sh

. ./cibuild.sh contrib
. ./cibuild.sh vector
. ./cibuild.sh node
. ./cibuild.sh linkweb
. ./cibuild.sh pglite-prep