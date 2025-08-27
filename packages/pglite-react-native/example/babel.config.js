module.exports = function (api) {
  api.cache(true)
  return {
    presets: [[
      'babel-preset-expo',
      {
        // Enable polyfill/transform for `import.meta` so Hermes can handle it
        unstable_transformImportMeta: true,
      },
    ]],
  }
}

