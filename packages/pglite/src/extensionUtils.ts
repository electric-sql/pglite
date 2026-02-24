import tinyTar from 'tinytar'
import { IN_NODE } from './utils.js'
import type { PostgresMod } from './postgresMod.js'

export async function loadExtensionBundle(
  bundlePath: URL,
): Promise<Blob | null> {
  // Async load the extension bundle tar file
  // could be from a URL or a file
  if (IN_NODE) {
    const fs = await import('fs')
    const zlib = await import('zlib')
    const { Writable } = await import('stream')
    const { pipeline } = await import('stream/promises')

    if (!fs.existsSync(bundlePath)) {
      throw new Error(`Extension bundle not found: ${bundlePath}`)
    }

    const gunzip = zlib.createGunzip()
    const chunks: Uint8Array[] = []

    await pipeline(
      fs.createReadStream(bundlePath),
      gunzip,
      new Writable({
        write(chunk, _encoding, callback) {
          chunks.push(chunk)
          callback()
        },
      }),
    )
    return new Blob(chunks)
  } else {
    const response = await fetch(bundlePath.toString())
    if (!response.ok || !response.body) {
      return null
    } else if (response.headers.get('Content-Encoding') === 'gzip') {
      // Although the bundle is manually compressed, some servers will recognize
      // that and add a content-encoding header. Fetch will then automatically
      // decompress the response.
      return response.blob()
    } else {
      const decompressionStream = new DecompressionStream('gzip')
      const decompressedStream = new Response(
        response.body.pipeThrough(decompressionStream),
      )
      return decompressedStream.blob()
    }
  }
}

export async function loadExtensions(
  mod: PostgresMod,
  log: (...args: any[]) => void,
) {
  for (const ext in mod.pg_extensions) {
    let blob
    try {
      blob = await mod.pg_extensions[ext]
    } catch (err) {
      console.error('Failed to fetch extension:', ext, err)
      continue
    }
    if (blob) {
      const bytes = new Uint8Array(await blob.arrayBuffer())
      // Await all async WASM precompilations so preloadedWasm is populated
      // before dlopen is called during postgres startup.
      await Promise.all(loadExtension(mod, ext, bytes, log))
    } else {
      console.error('Could not get binary data for extension:', ext)
    }
  }
}

function loadExtension(
  mod: PostgresMod,
  _ext: string,
  bytes: Uint8Array,
  log: (...args: any[]) => void,
): Promise<void>[] {
  const soPreloadPromises: Promise<void>[] = []
  const data = tinyTar.untar(bytes)
  data.forEach((file: any) => {
    if (!file.name.startsWith('.')) {
      const filePath = mod.WASM_PREFIX + '/' + file.name
      if (file.name.endsWith('.so')) {
        const soName = file.name.split('/').pop()!  // e.g. 'postgis-3.so'
        const dirPath = dirname(filePath)
        // Wrap createPreloadedFile in a Promise so loadExtensions can await the
        // async WASM compilation done by Emscripten's wasm preload plugin.
        // The plugin calls extOk only after preloadedWasm[path] is set, so
        // awaiting this ensures dlopen finds the pre-compiled module.
        const soPreload = new Promise<void>((resolve, reject) => {
          const extOk = (...args: any[]) => {
            log('pgfs:ext OK', filePath, args)
            resolve()
          }
          const extFail = (...args: any[]) => {
            log('pgfs:ext FAIL', filePath, args)
            reject(new Error(`Failed to preload ${filePath}`))
          }
          // Keep the .so suffix so Emscripten's wasm preload plugin canHandle() matches,
          // triggering async WebAssembly.instantiate. The compiled module is stored in
          // preloadedWasm under the path with .so.
          mod.FS.createPreloadedFile(
            dirPath,
            soName,
            file.data as any, // There is a type error in Emscripten's FS.createPreloadedFile, this excepts a Uint8Array, but the type is defined as any
            true,
            true,
            extOk,
            extFail,
            false,
          )
        })
        soPreloadPromises.push(soPreload)
      } else {
        try {
          const dirPath = filePath.substring(0, filePath.lastIndexOf('/'))
          if (mod.FS.analyzePath(dirPath).exists === false) {
            mod.FS.mkdirTree(dirPath)
          }
          mod.FS.writeFile(filePath, file.data)
        } catch (e) {
          console.error(`Error writing file ${filePath}`, e)
        }
      }
    }
  })
  return soPreloadPromises
}

function dirname(path: string) {
  const last = path.lastIndexOf('/')
  if (last > 0) {
    return path.slice(0, last)
  } else {
    return path
  }
}
