import { defineConfig } from 'tsup'
import path from 'path'

const thisFile = new URL(import.meta.url).pathname
const root = path.dirname(thisFile)

let replaceAssertPlugin = {
  name: 'replace-assert',
  setup(build: any) {
    // Resolve `assert` to a blank file
    build.onResolve({ filter: /^assert$/ }, (args: any) => {
      return { path: path.join(root, 'src', 'blank.ts') }
    })
  },
}

export default defineConfig({
  entry: ['src/index.ts'],
  sourcemap: true,
  dts: {
    entry: 'src/index.ts',
    resolve: true
  },
  clean: true,
  format: ['esm'],
  esbuildOptions(options, context) {
    options.inject = ['src/buffer-polyfill.ts']
  },
  esbuildPlugins: [
    replaceAssertPlugin,
  ],
})
