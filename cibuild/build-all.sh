#!/bin/bash
echo "======== build-all.sh : $(pwd)             =========="

echo "======== Installing packages =========="

apt update && apt install -y git bison flex

echo "======== Building all PGlite prerequisites =========="

# move copy of patches into dir
# not mounting them directly as lots of files are created
cp -rf /opt/patches ./patches

. ./cibuild.sh

. ./cibuild.sh contrib
. ./cibuild.sh extra
. ./cibuild.sh node
. ./cibuild.sh linkweb
. ./cibuild.sh pglite-prep
