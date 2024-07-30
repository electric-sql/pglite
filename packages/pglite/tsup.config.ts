import { defineConfig } from "tsup";
import path from "path";
import { fileURLToPath } from "url";

const thisFile = fileURLToPath(new URL(import.meta.url));
const root = path.dirname(thisFile);

const replaceAssertPlugin = {
  name: "replace-assert",
  setup(build: any) {
    // Resolve `assert` to a blank file
    build.onResolve({ filter: /^assert$/ }, (args: any) => {
      return { path: path.join(root, "src", "polyfills", "blank.ts") };
    });
  },
};

const entryPoints = [
  "src/index.ts",
  'src/live/index.ts',
  "src/worker/index.ts",
  "src/vector/index.ts",
  "src/fs/opfs-ahp/index.ts",
  "src/fs/nodefs.ts",
  "src/contrib/pg_trgm.ts",
];

export default defineConfig({
  entry: entryPoints,
  sourcemap: true,
  dts: {
    entry: entryPoints,
    resolve: true,
  },
  clean: true,
  format: ["esm"],
  external: ["../release/postgres.js"],
  esbuildOptions(options, context) {
    options.inject = [
      "src/polyfills/buffer.ts",
      "src/polyfills/indirectEval.ts",
    ];
  },
  esbuildPlugins: [replaceAssertPlugin],
  minify: true,
});
