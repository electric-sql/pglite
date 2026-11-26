---
'@electric-sql/pglite': patch
---

Loading a data directory from a tarball (`loadDataDir`, `clone()`) is faster: each directory is now created once, instead of every parent directory being walked again for every file. Opening a 102 MB data directory of about 2,900 files took a median 312 ms instead of 400 ms in our measurements.
