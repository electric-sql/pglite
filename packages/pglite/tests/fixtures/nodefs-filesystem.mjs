export default function createNodeFilesystem({ root }) {
  if (typeof root !== 'string' || root.length === 0) {
    throw new TypeError('NODEFS test factory requires a root')
  }
  let pg
  return {
    async init(instance, options) {
      pg = instance
      return {
        emscriptenOpts: {
          ...options,
          preRun: [
            ...(options.preRun ?? []),
            (module) => {
              module.FS.mkdirTree('/pglite/data')
              module.FS.mount(
                module.FS.filesystems.NODEFS,
                { root },
                '/pglite/data',
              )
            },
          ],
        },
      }
    },
    async syncToFs() {},
    async initialSyncFs() {},
    async dumpTar() {
      throw new Error('not used by the Worker factory gate')
    },
    async closeFs() {
      pg.Module.FS.quit()
    },
  }
}
