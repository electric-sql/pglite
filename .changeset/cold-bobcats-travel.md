---
'@electric-sql/pglite-sync': patch
---

shapeKey in syncShapeToTable is now mandatory but nullable; passing null will not persist the shape
