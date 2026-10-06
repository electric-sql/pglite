import type { ShapeStreamOptions } from '@electric-sql/client'

export type PGliteSyncShapeStreamOptions<T = never> = ShapeStreamOptions<T> & {
  liveSse?: boolean
}

export function normalizeShapeStreamOptions<T = never>(
  shape: PGliteSyncShapeStreamOptions<T>,
): ShapeStreamOptions<T> {
  const { liveSse, ...shapeStreamOptions } = shape

  if (
    liveSse !== undefined &&
    shapeStreamOptions.experimentalLiveSse === undefined
  ) {
    return {
      ...shapeStreamOptions,
      experimentalLiveSse: liveSse,
    }
  }

  return shapeStreamOptions
}
