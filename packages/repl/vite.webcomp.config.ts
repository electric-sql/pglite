/// <reference types="vite/client" />

import { resolve } from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import dts from "vite-plugin-dts";
import packageJson from "./package.json";

export default defineConfig({
  plugins: [
    react(),
    dts({
      include: [
        "./src-webcomponent/main.tsx",
        "./src/Repl.tsx",
      ]
    }),
  ],
  optimizeDeps: {
    exclude: ["@electric-sql/pglite"],
  },
  define: {'process.env': {}},
  build: {
    lib: {
      entry: resolve(import.meta.dirname, "./src-webcomponent/main.tsx"),
      name: "PGliteREPL",
      fileName: "Repl",
      // formats: ["iife", "es"],
      formats: ["es"],
    },
    sourcemap: true,
    minify: "terser",
    outDir: "dist-webcomponent",
    rollupOptions: {
      external: [
        ...Object.keys(packageJson.peerDependencies),
        ...Object.keys(packageJson.devDependencies),
      ],
    },
  },
});
