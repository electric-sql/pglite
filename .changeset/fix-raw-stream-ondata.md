---
'@electric-sql/pglite': patch
---

reset the stream callback after execProtocolRawStream so later execProtocolRaw/execProtocolRawSync calls are not routed to it
