# Four-way benchmark measurements

Each cell is the median of four fresh processes. Latency and startup are milliseconds, throughput is queries/s, and memory is MiB. The individual process measurements, query-plan trees, input hashes and provider counts are in [measurements.json](measurements.json).

## Qualified compiler

| Workload | Stock classic | Linked classic | Native postmaster | Linked postmaster |
| --- | ---: | ---: | ---: | ---: |
| Startup through first SELECT | 1,387.6 | 1,441.8 | 2,147.3 | 2,941.2 |
| Indexed point lookup | 0.132 | 0.133 | 0.363 | 0.487 |
| Indexed update | 0.141 | 0.144 | 0.445 | 0.432 |
| Hash join | 5.76 | 5.93 | 10.23 | 11.82 |
| Indexed PostGIS search | 0.260 | 0.274 | 0.619 | 0.751 |
| Inline, heap only | 0.307 | 0.319 | 0.810 | 0.937 |
| Inline, read byte | 0.314 | 0.328 | 0.840 | 0.887 |
| Inline, copy and modify | 0.426 | 0.443 | 0.994 | 2.07 |
| External, heap only | 0.205 | 0.213 | 0.448 | 0.637 |
| External, read byte | 1.98 | 2.00 | 3.92 | 5.70 |
| External, copy and modify | 1.95 | 1.94 | 3.85 | 5.76 |
| HNSW top 10 | 0.859 | 0.847 | 1.17 | 2.18 |
| Build HNSW | 2,093.1 | 2,151.2 | 2,230.3 | 2,221.9 |
| Serial aggregate | 3.97 | 3.93 | 6.58 | 7.60 |
| Two-worker aggregate | — | — | 182.2 | 183.0 |
| Point queries/s, 1 session(s) | 7,850.7 | 8,216.4 | 2,237.0 | 2,315.7 |
| Point queries/s, 2 session(s) | — | — | 3,431.0 | 3,309.1 |
| Point queries/s, 4 session(s) | — | — | 4,538.9 | 4,484.5 |
| Point queries/s, 8 session(s) | — | — | 4,788.2 | 4,467.1 |
| HNSW queries/s, 1 session(s) | 1,164.2 | 1,180.6 | 852.7 | 459.2 |
| HNSW queries/s, 2 session(s) | — | — | 1,306.8 | 810.6 |
| HNSW queries/s, 4 session(s) | — | — | 1,817.4 | 1,179.5 |
| HNSW queries/s, 8 session(s) | — | — | 2,419.4 | 1,817.2 |
| Process RSS, 1 session(s) | 697.8 | 802.2 | 2,429.7 | 2,385.1 |
| Private linear heaps, 1 session(s) | 153.6 | 184.4 | 192.0 | 192.0 |
| Global heap, 1 session(s) | — | — | 22.25 | 22.25 |
| Scoped heaps, 1 session(s) | — | — | 0.250 | 0.250 |
| Process RSS, 2 session(s) | — | — | 2,544.5 | 2,462.0 |
| Private linear heaps, 2 session(s) | — | — | 224.0 | 224.0 |
| Global heap, 2 session(s) | — | — | 22.25 | 22.25 |
| Scoped heaps, 2 session(s) | — | — | 0.375 | 0.375 |
| Process RSS, 4 session(s) | — | — | 2,845.5 | 2,834.5 |
| Private linear heaps, 4 session(s) | — | — | 288.0 | 288.0 |
| Global heap, 4 session(s) | — | — | 22.25 | 22.25 |
| Scoped heaps, 4 session(s) | — | — | 0.625 | 0.625 |
| Process RSS, 8 session(s) | — | — | 3,590.7 | 3,582.5 |
| Private linear heaps, 8 session(s) | — | — | 416.0 | 416.0 |
| Global heap, 8 session(s) | — | — | 22.25 | 22.25 |
| Scoped heaps, 8 session(s) | — | — | 1.12 | 1.12 |
| Additional RSS per session, 1 to 8 | — | — | 166.1 | 172.2 |

## Experimental compiler

| Workload | Stock classic | Linked classic | Native postmaster | Linked postmaster |
| --- | ---: | ---: | ---: | ---: |
| Startup through first SELECT | 1,318.5 | 1,410.3 | 2,209.8 | 2,895.2 |
| Indexed point lookup | 0.135 | 0.132 | 0.401 | 0.579 |
| Indexed update | 0.149 | 0.141 | 0.401 | 0.469 |
| Hash join | 5.79 | 5.79 | 11.15 | 12.84 |
| Indexed PostGIS search | 0.264 | 0.263 | 0.705 | 0.777 |
| Inline, heap only | 0.306 | 0.308 | 0.725 | 0.917 |
| Inline, read byte | 0.311 | 0.316 | 0.840 | 0.949 |
| Inline, copy and modify | 0.424 | 0.423 | 0.843 | 1.99 |
| External, heap only | 0.207 | 0.210 | 0.649 | 0.636 |
| External, read byte | 1.99 | 2.02 | 3.93 | 5.96 |
| External, copy and modify | 1.96 | 1.96 | 3.86 | 5.87 |
| HNSW top 10 | 0.850 | 0.839 | 1.21 | 1.82 |
| Build HNSW | 2,114.9 | 2,136.7 | 2,195.4 | 2,208.4 |
| Serial aggregate | 3.91 | 3.97 | 6.69 | 7.79 |
| Two-worker aggregate | — | — | 180.8 | 181.7 |
| Point queries/s, 1 session(s) | 7,957.1 | 8,130.2 | 2,201.9 | 2,366.8 |
| Point queries/s, 2 session(s) | — | — | 3,414.6 | 3,217.8 |
| Point queries/s, 4 session(s) | — | — | 4,293.8 | 4,298.3 |
| Point queries/s, 8 session(s) | — | — | 4,929.9 | 4,434.2 |
| HNSW queries/s, 1 session(s) | 1,177.2 | 1,191.9 | 826.1 | 548.5 |
| HNSW queries/s, 2 session(s) | — | — | 1,326.3 | 942.5 |
| HNSW queries/s, 4 session(s) | — | — | 1,787.3 | 1,347.9 |
| HNSW queries/s, 8 session(s) | — | — | 2,386.5 | 2,117.6 |
| Process RSS, 1 session(s) | 682.9 | 809.1 | 2,598.3 | 2,363.8 |
| Private linear heaps, 1 session(s) | 153.6 | 184.4 | 192.0 | 192.0 |
| Global heap, 1 session(s) | — | — | 22.25 | 22.25 |
| Scoped heaps, 1 session(s) | — | — | 0.250 | 0.250 |
| Process RSS, 2 session(s) | — | — | 2,685.7 | 2,440.4 |
| Private linear heaps, 2 session(s) | — | — | 224.0 | 224.0 |
| Global heap, 2 session(s) | — | — | 22.25 | 22.25 |
| Scoped heaps, 2 session(s) | — | — | 0.375 | 0.375 |
| Process RSS, 4 session(s) | — | — | 3,022.2 | 2,813.2 |
| Private linear heaps, 4 session(s) | — | — | 288.0 | 288.0 |
| Global heap, 4 session(s) | — | — | 22.25 | 22.25 |
| Scoped heaps, 4 session(s) | — | — | 0.625 | 0.625 |
| Process RSS, 8 session(s) | — | — | 3,769.6 | 3,565.4 |
| Private linear heaps, 8 session(s) | — | — | 416.0 | 416.0 |
| Global heap, 8 session(s) | — | — | 22.25 | 22.25 |
| Scoped heaps, 8 session(s) | — | — | 1.12 | 1.12 |
| Additional RSS per session, 1 to 8 | — | — | 167.4 | 170.8 |

## Linked postmaster rule attribution

All four variants use the expanded providers. Cells show median [minimum, maximum] milliseconds across four fresh processes. The two rules vary independently.

| Workload | Neither rule | Paired reads | Constant offsets | Both rules |
| --- | ---: | ---: | ---: | ---: |
| Indexed point lookup | 0.547 [0.382, 0.593] | 0.541 [0.511, 0.669] | 0.515 [0.400, 0.589] | 0.400 [0.346, 0.593] |
| Indexed update | 0.541 [0.396, 0.586] | 0.471 [0.393, 0.514] | 0.530 [0.378, 0.584] | 0.466 [0.373, 0.570] |
| Hash join | 12.49 [11.32, 13.65] | 11.48 [11.43, 13.72] | 11.77 [11.30, 12.18] | 12.70 [11.51, 14.08] |
| Indexed PostGIS search | 0.774 [0.556, 0.795] | 0.747 [0.724, 0.831] | 0.772 [0.756, 0.894] | 0.537 [0.506, 0.778] |
| Inline, heap only | 0.890 [0.768, 0.924] | 0.830 [0.731, 0.935] | 0.913 [0.751, 0.929] | 0.836 [0.744, 0.930] |
| Inline, read byte | 0.806 [0.792, 0.976] | 0.880 [0.772, 1.06] | 0.795 [0.787, 0.887] | 0.886 [0.769, 0.986] |
| Inline, copy and modify | 2.00 [1.78, 2.22] | 1.96 [1.75, 2.03] | 1.93 [1.72, 2.89] | 1.97 [1.94, 1.97] |
| External, heap only | 0.535 [0.517, 0.714] | 0.526 [0.513, 0.530] | 0.772 [0.742, 0.848] | 0.727 [0.520, 0.777] |
| External, read byte | 5.89 [5.70, 6.14] | 5.70 [5.51, 5.87] | 6.07 [5.70, 6.42] | 5.94 [5.80, 5.97] |
| External, copy and modify | 5.70 [5.62, 5.78] | 5.70 [5.67, 5.75] | 5.95 [5.80, 6.19] | 5.62 [5.54, 5.71] |
| HNSW top 10 | 2.36 [2.17, 2.51] | 1.78 [1.75, 1.79] | 2.19 [2.17, 2.24] | 1.95 [1.80, 2.02] |
| Build HNSW | 2,213.0 [2,181.4, 2,225.1] | 2,202.8 [2,180.9, 2,215.8] | 2,202.7 [2,169.1, 2,286.8] | 2,199.4 [2,189.7, 2,201.0] |

## Compressed distribution sizes

| Package or contained archive | MiB |
| --- | ---: |
| stock electric-sql-pglite-0.5.4.tgz | 15.77 |
| stock electric-sql-pglite-pgvector-0.0.5.tgz | 0.168 |
| vector.tar.gz | 0.044 |
| vector.wasm32-classic.tar.gz | 0.047 |
| vector.wasm32-multi-memory.tar.gz | 0.062 |
| stock electric-sql-pglite-postgis-0.2.4.tgz | 40.31 |
| postgis.tar.gz | 12.92 |
| postgis.wasm32-classic.tar.gz | 12.81 |
| postgis.wasm32-multi-memory.tar.gz | 14.87 |
| linked electric-sql-pglite-0.5.4.tgz | 16.22 |
| linked electric-sql-pglite-pgvector-0.0.5.tgz | 0.074 |
| vector.tar.gz | 0.061 |
| linked electric-sql-pglite-postgis-0.2.4.tgz | 14.80 |
| postgis.tar.gz | 14.88 |
| candidate electric-sql-pglite-0.5.4.tgz | 16.17 |
| candidate electric-sql-pglite-pgvector-0.0.5.tgz | 0.074 |
| vector.tar.gz | 0.061 |
| candidate electric-sql-pglite-postgis-0.2.4.tgz | 14.80 |
| postgis.tar.gz | 14.88 |
