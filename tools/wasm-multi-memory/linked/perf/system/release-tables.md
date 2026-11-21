# Installed wasm32 package comparison

Four fresh processes per cell. The ratio divides linked postmaster by native postmaster. Lower latency and higher throughput are better. Memory is measured after extension installation unless indicated.

| Workload | Stock classic | Linked classic | Native postmaster | Linked postmaster | Postmaster ratio |
| --- | ---: | ---: | ---: | ---: | ---: |
| Cold startup through SELECT 1, ms | 1,329.4 | 1,327.9 | 2,170.5 | 1,763.2 | 0.81× |
| First CREATE EXTENSION vector and postgis, ms | 2,460.1 | 2,570.6 | 2,701.6 | 2,868.7 | 1.06× |
| Indexed point lookup, ms | 0.133 | 0.135 | 0.535 | 0.532 | 0.99× |
| Indexed update, ms | 0.141 | 0.142 | 0.613 | 0.527 | 0.86× |
| Hash join, ms | 5.74 | 5.72 | 10.62 | 12.95 | 1.22× |
| Indexed PostGIS search, ms | 0.253 | 0.267 | 0.586 | 0.569 | 0.97× |
| Inline, heap only, ms | 0.304 | 0.308 | 0.854 | 0.863 | 1.01× |
| Inline, read byte, ms | 0.313 | 0.311 | 0.913 | 0.873 | 0.96× |
| Inline, copy and modify, ms | 0.424 | 0.422 | 1.09 | 1.14 | 1.05× |
| External, heap only, ms | 0.207 | 0.205 | 0.538 | 0.719 | 1.34× |
| External, read byte, ms | 1.97 | 1.95 | 4.12 | 5.45 | 1.32× |
| External, copy and modify, ms | 1.94 | 1.92 | 4.08 | 5.43 | 1.33× |
| HNSW top 10, ms | 0.832 | 0.855 | 1.25 | 1.45 | 1.16× |
| Build HNSW, ms | 2,117.6 | 2,122.7 | 2,214.1 | 2,218.2 | 1.00× |
| Serial aggregate, ms | 3.93 | 3.96 | 6.63 | 7.63 | 1.15× |
| Two-worker aggregate, ms | — | — | 178.2 | 90.74 | 0.51× |
| point, 1 session(s), queries/s | 8,201.7 | 8,088.9 | 2,251.7 | 2,096.7 | 0.93× |
| hnsw_search, 1 session(s), queries/s | 1,201.3 | 1,170.2 | 798.5 | 688.0 | 0.86× |
| rss, 1 session(s), MiB | 698.8 | 744.8 | 2,793.8 | 1,791.1 | 0.64× |
| privateBytes, 1 session(s), MiB | 153.6 | 153.6 | 192.0 | 192.0 | 1.00× |
| globalBytes, 1 session(s), MiB | — | — | 22.25 | 22.25 | 1.00× |
| scopedBytes, 1 session(s), MiB | — | — | 0.250 | 0.250 | 1.00× |
| point, 2 session(s), queries/s | — | — | 3,441.5 | 3,412.8 | 0.99× |
| hnsw_search, 2 session(s), queries/s | — | — | 1,322.7 | 1,160.7 | 0.88× |
| rss, 2 session(s), MiB | — | — | 2,922.9 | 1,828.8 | 0.63× |
| privateBytes, 2 session(s), MiB | — | — | 224.0 | 224.0 | 1.00× |
| globalBytes, 2 session(s), MiB | — | — | 22.25 | 22.25 | 1.00× |
| scopedBytes, 2 session(s), MiB | — | — | 0.375 | 0.375 | 1.00× |
| point, 4 session(s), queries/s | — | — | 4,377.6 | 4,308.6 | 0.98× |
| hnsw_search, 4 session(s), queries/s | — | — | 1,686.1 | 1,605.2 | 0.95× |
| rss, 4 session(s), MiB | — | — | 3,211.9 | 2,072.1 | 0.65× |
| privateBytes, 4 session(s), MiB | — | — | 288.0 | 288.0 | 1.00× |
| globalBytes, 4 session(s), MiB | — | — | 22.25 | 22.25 | 1.00× |
| scopedBytes, 4 session(s), MiB | — | — | 0.625 | 0.625 | 1.00× |
| point, 8 session(s), queries/s | — | — | 4,532.5 | 4,749.1 | 1.05× |
| hnsw_search, 8 session(s), queries/s | — | — | 2,392.1 | 2,163.0 | 0.90× |
| rss, 8 session(s), MiB | — | — | 3,954.7 | 2,553.1 | 0.65× |
| privateBytes, 8 session(s), MiB | — | — | 416.0 | 416.0 | 1.00× |
| globalBytes, 8 session(s), MiB | — | — | 22.25 | 22.25 | 1.00× |
| scopedBytes, 8 session(s), MiB | — | — | 1.12 | 1.12 | 1.00× |
| RSS before CREATE EXTENSION, MiB | 830.5 | 840.2 | 2,759.0 | 1,525.2 | 0.55× |
| Peak process RSS, MiB | 938.7 | 982.8 | 4,686.4 | 2,945.8 | 0.63× |
| Additional RSS per session from 1 to 8, MiB | — | — | 165.7 | 108.4 | 0.65× |
| Additional session through first SELECT, ms | — | — | 169.3 | 82.47 | 0.49× |

## Startup diagnostics

One additional instrumented process per configuration. Worker timings overlap.

| Phase | Stock classic | Linked classic | Native postmaster | Linked postmaster |
| --- | ---: | ---: | ---: | ---: |
| Classic create, including nested initdb (ms) | 1,480.5 | 1,295.1 | 735.0 | 733.4 |
| Postmaster extension preparation (ms) | — | — | 460.4 | 435.3 |
| Worker start through online (median ms) | — | — | 11.94 | 11.38 |
| Worker start through runtime ready (median ms) | — | — | 215.2 | 90.17 |
| Wasm instantiation per worker (median ms) | — | — | 25.51 | 4.66 |
| First postmaster connection (ms) | — | — | 238.3 | 153.9 |
