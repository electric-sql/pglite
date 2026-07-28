import type { ConfigurableExtension, Extension } from './interface.js'
import type { PGliteConfiguredArtifactOverride } from './extension-artifacts.js'

const configurations = new WeakMap<
  Extension<any, any>,
  Readonly<PGliteConfiguredArtifactOverride>
>()

export function defineExtension<TNamespace, TClusterNamespace = never>(
  definition: Extension<TNamespace, TClusterNamespace>,
): ConfigurableExtension<TNamespace, TClusterNamespace> {
  return configuredExtension(definition, undefined)
}

export function getExtensionArtifactOverride(
  extension: Extension<any, any>,
): Readonly<PGliteConfiguredArtifactOverride> | undefined {
  return configurations.get(extension)
}

function configuredExtension<TNamespace, TClusterNamespace>(
  definition: Extension<TNamespace, TClusterNamespace>,
  configuration: PGliteConfiguredArtifactOverride | undefined,
): ConfigurableExtension<TNamespace, TClusterNamespace> {
  const extension: ConfigurableExtension<TNamespace, TClusterNamespace> = {
    ...definition,
    configure(options) {
      return configuredExtension(definition, options)
    },
  }
  if (configuration) configurations.set(extension, Object.freeze(configuration))
  return Object.freeze(extension)
}
