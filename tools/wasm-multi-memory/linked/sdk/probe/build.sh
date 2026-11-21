#!/usr/bin/env bash
# This fixture is built with only the SDK, its C source and an output directory.
set -euo pipefail
cd "$(mktemp -d)"
mkdir -p files/lib/postgresql files/share/postgresql/extension
pglite-linked-cc /probe/probe.c -o files/lib/postgresql/linked_probe.so
cat >files/share/postgresql/extension/linked_probe.control <<'CONTROL'
comment = 'linked SDK integration probe'
default_version = '1.0'
relocatable = true
CONTROL
cat >files/share/postgresql/extension/linked_probe--1.0.sql <<'SQL'
CREATE FUNCTION linked_byte_sum(bytea) RETURNS integer
AS '$libdir/linked_probe', 'linked_byte_sum' LANGUAGE C IMMUTABLE STRICT;
CREATE FUNCTION linked_squared_distance(real[],real[]) RETURNS double precision
AS '$libdir/linked_probe', 'linked_squared_distance' LANGUAGE C IMMUTABLE STRICT;
SQL
tar -czf raw.tar.gz -C files .
jq '{target:.,extensionName:"linked_probe",extensionVersion:"1.0"}' /opt/pglite-linked/target.json >config.json
pglite-linked-package config.json raw.tar.gz /output/linked_probe.tar.gz /output/linked_probe.json /output/reports
jq -e '.extensionManifest.processConfig.requiredHostCapabilities | index("wasm-linked-f32x8-v1") != null' /output/linked_probe.json >/dev/null
