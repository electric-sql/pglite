export default function createNodeFilesystem({ root, mounts = [] }) {
  if (typeof root !== 'string' || root.length === 0) {
    throw new TypeError('NODEFS test factory requires a root')
  }
  if (!Array.isArray(mounts)) {
    throw new TypeError('NODEFS test mounts must be an array')
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
              for (const mount of mounts) {
                if (
                  typeof mount?.root !== 'string' ||
                  typeof mount?.path !== 'string' ||
                  !mount.path.startsWith('/')
                ) {
                  throw new TypeError('invalid NODEFS test mount')
                }
                module.FS.mkdirTree(mount.path)
                module.FS.mount(
                  module.FS.filesystems.NODEFS,
                  { root: mount.root },
                  mount.path,
                )
              }
            },
          ],
        },
      }
    },
    async syncToFs() {},
    async initialSyncFs() {},
    async dumpTar() {
      throw new Error('NODEFS test filesystem does not implement dumpTar')
    },
    async closeFs() {
      pg.Module.FS.quit()
    },
  }
}
