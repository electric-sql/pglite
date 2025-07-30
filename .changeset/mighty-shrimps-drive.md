---
'@electric-sql/pglite-tools': patch
---

fix pg_dump on Windows systems

When calling **pg_dump** on Windows system the function fails with an error as the one bellow. 
❗ Notice the double drive letter
`Error: ENOENT: no such file or directory, open 'E:\C:\Users\<USERNAME>\AppData\Local\npm-cache\_npx\ba4f1959e38407b5\node_modules\@electric-sql\pglite-tools\dist\pg_dump.wasm'` 

The problem is in execPgDump function at line
`const blob = await fs.readFile(bin.toString().slice(7))`
I think the intention here was to remove `file://` from the begging of the path. However this is not necesarry readFile can handle URL objects.
Moreover this will fail on Windows becase the slice creates a path like '/C:/<USERNAME>...' and the readFile function will add the extra drive letter