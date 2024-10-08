import { worker } from "@electric-sql/pglite/worker";
import { HttpFs } from "@electric-sql/pglite/httpfs/browser";
import { PGlite } from "@electric-sql/pglite";

worker({
  async init() {
    const pg = await PGlite.create({
      fs: new HttpFs("/pagila", { 
        fetchGranularity: 'page', // 'file' or 'page'
      }),
    });
    return pg;
  },
});
