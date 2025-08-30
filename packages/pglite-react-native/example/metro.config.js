// Learn more https://docs.expo.io/guides/customizing-metro
const path = require('path')
const { getDefaultConfig } = require('expo/metro-config')

const projectRoot = __dirname
const packageRoot = path.resolve(projectRoot, '..')
const pgProtocolRoot = path.resolve(projectRoot, '..', '..', 'pg-protocol')

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(projectRoot)

// Watch local packages so Metro can resolve and transform TS sources there
config.watchFolders = Array.from(new Set([packageRoot, pgProtocolRoot]))

config.resolver = {
  ...config.resolver,
  // Resolve modules from the example's node_modules first
  nodeModulesPaths: [path.resolve(projectRoot, 'node_modules')],
  // Map local packages to their source so we don't rely on prebuilt dist/
  extraNodeModules: {
    ...(config.resolver?.extraNodeModules || {}),
    '@electric-sql/pglite-react-native': path.resolve(packageRoot, 'src'),
    '@electric-sql/pg-protocol': path.resolve(pgProtocolRoot, 'src'),
  },
}

module.exports = config
