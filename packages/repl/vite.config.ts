import { resolve } from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import dts from "vite-plugin-dts";
import libCss from 'vite-plugin-libcss';
import packageJson from "./package.json";

export default defineConfig({
  plugins: [
    react(),
    libCss(),
    dts({
      include: [
        "./src/Repl.tsx",
      ]
    }),
  ],
  optimizeDeps: {
    exclude: ["@electric-sql/pglite"],
  },
  build: {
    lib: {
      entry: resolve(__dirname, "src/Repl.tsx"),
      name: "PGliteREPL",
      fileName: "Repl",
      // formats: ["es"],
    },
    sourcemap: true,
    minify: false,
    rollupOptions: {
      external: [
        "react/jsx-runtime",
        ...Object.keys(packageJson.dependencies),
        ...Object.keys(packageJson.peerDependencies),
        ...Object.keys(packageJson.devDependencies),
      ],
    },
  },
});
