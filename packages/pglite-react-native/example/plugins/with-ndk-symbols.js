// Expo config plugin to ensure Android app/build.gradle has ndk { debugSymbolLevel 'FULL' } for Debug builds
// Docs: https://docs.expo.dev/config-plugins/mods/

const {
  withAppBuildGradle,
  createRunOncePlugin,
} = require('@expo/config-plugins')

const PLUGIN_NAME = 'with-ndk-symbols'
const PLUGIN_VERSION = '1.0.1'

// Find a block like: <keyword> { ... } and return indexes { open, close }
function findBlock(contents, startIdx, keyword) {
  const k = contents.indexOf(keyword, startIdx)
  if (k < 0) return null
  const brace = contents.indexOf('{', k)
  if (brace < 0) return null
  let depth = 1
  for (let i = brace + 1; i < contents.length; i++) {
    const ch = contents[i]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return { key: k, open: brace, close: i }
    }
  }
  return null
}

function ensureNdkInBuildTypesDebug(contents) {
  const needle = "debugSymbolLevel 'FULL'"
  if (contents.includes(needle)) return contents

  // 1) Locate android { ... }
  const androidBlk = findBlock(contents, 0, 'android')
  if (!androidBlk) return contents // nothing to do

  // 2) Within android, locate buildTypes { ... }
  const buildTypesBlk = findBlock(contents, androidBlk.open + 1, 'buildTypes')

  if (buildTypesBlk) {
    // 2a) Within buildTypes, locate debug { ... }
    const debugBlk = findBlock(contents, buildTypesBlk.open + 1, 'debug')
    if (debugBlk) {
      // Ensure we don't modify signingConfigs.debug by verifying the block is inside buildTypes range
      if (
        debugBlk.open > buildTypesBlk.open &&
        debugBlk.close < buildTypesBlk.close
      ) {
        const debugBody = contents.slice(debugBlk.open + 1, debugBlk.close)
        if (debugBody.includes(needle)) return contents // already present in correct place
        const insertionPoint = debugBlk.open + 1
        const insertion = "\n            ndk { debugSymbolLevel 'FULL' }\n"
        return (
          contents.slice(0, insertionPoint) +
          insertion +
          contents.slice(insertionPoint)
        )
      }
    }
    // No debug block; insert one at top of buildTypes
    const insertAt = buildTypesBlk.open + 1
    const toInsert = `\n        debug {\n            ndk { debugSymbolLevel 'FULL' }\n        }\n`
    return contents.slice(0, insertAt) + toInsert + contents.slice(insertAt)
  }

  // 3) No buildTypes; create it under android
  const androidInsertAt = androidBlk.open + 1
  const bt = `\n    buildTypes {\n        debug {\n            ndk { debugSymbolLevel 'FULL' }\n        }\n    }\n`
  return (
    contents.slice(0, androidInsertAt) + bt + contents.slice(androidInsertAt)
  )
}

const withNdkSymbols = (config) => {
  return withAppBuildGradle(config, (config) => {
    if (!config.modResults || typeof config.modResults.contents !== 'string')
      return config
    const before = config.modResults.contents
    const after = ensureNdkInBuildTypesDebug(before)
    config.modResults.contents = after
    return config
  })
}

module.exports = createRunOncePlugin(
  withNdkSymbols,
  PLUGIN_NAME,
  PLUGIN_VERSION,
)
