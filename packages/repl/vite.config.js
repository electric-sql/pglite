'use strict'
var __spreadArray =
  (this && this.__spreadArray) ||
  function (to, from, pack) {
    if (pack || arguments.length === 2)
      for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
          if (!ar) ar = Array.prototype.slice.call(from, 0, i)
          ar[i] = from[i]
        }
      }
    return to.concat(ar || Array.prototype.slice.call(from))
  }
Object.defineProperty(exports, '__esModule', { value: true })
var path_1 = require('path')
var vite_1 = require('vite')
var plugin_react_1 = require('@vitejs/plugin-react')
var vite_plugin_dts_1 = require('vite-plugin-dts')
var vite_plugin_libcss_1 = require('vite-plugin-libcss')
var package_json_1 = require('./package.json')
exports.default = (0, vite_1.defineConfig)({
  plugins: [
    (0, plugin_react_1.default)(),
    (0, vite_plugin_libcss_1.default)(),
    (0, vite_plugin_dts_1.default)({
      include: ['./src/Repl.tsx'],
    }),
  ],
  optimizeDeps: {
    exclude: ['@electric-sql/pglite'],
  },
  build: {
    lib: {
      entry: (0, path_1.resolve)(import.meta.dirname, 'src/Repl.tsx'),
      name: 'PGliteREPL',
      fileName: 'Repl',
      // formats: ["es"],
    },
    sourcemap: true,
    minify: false,
    rollupOptions: {
      external: __spreadArray(
        __spreadArray(
          __spreadArray(
            ['react/jsx-runtime'],
            Object.keys(package_json_1.default.dependencies),
            true,
          ),
          Object.keys(package_json_1.default.peerDependencies),
          true,
        ),
        Object.keys(package_json_1.default.devDependencies),
        true,
      ),
    },
  },
})
