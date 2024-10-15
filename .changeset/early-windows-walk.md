---
'@electric-sql/pglite-react': patch
---

Enable passing the return value of a live query directly to `useLiveQuery`. This allows you to create a live query in a react-router loader, then pass it to the route component where it is then attached with `useLiveQuery`.
