ARG PGLITE_BASE_IMAGE=pglite-linked-classic-sdk:local
FROM ${PGLITE_BASE_IMAGE}
COPY include/ /opt/pglite-linked/include/
COPY target.json /opt/pglite-linked/target.json
COPY --chmod=755 cc.sh /usr/local/bin/pglite-linked-cc
