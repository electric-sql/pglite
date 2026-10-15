import { describe, expect, it } from 'vitest'
import {
  normalizeShapeStreamOptions,
  type PGliteSyncShapeStreamOptions,
} from '../src/shapeStreamOptions'

describe('normalizeShapeStreamOptions', () => {
  it('maps liveSse to the Electric client SSE option', () => {
    const shape: PGliteSyncShapeStreamOptions = {
      url: 'http://localhost:3000/v1/shape',
      liveSse: true,
    }

    const normalized = normalizeShapeStreamOptions(shape)

    expect(normalized).toEqual({
      url: 'http://localhost:3000/v1/shape',
      experimentalLiveSse: true,
    })
    expect('liveSse' in normalized).toBe(false)
  })

  it('preserves explicit experimentalLiveSse when both options are provided', () => {
    const normalized = normalizeShapeStreamOptions({
      url: 'http://localhost:3000/v1/shape',
      liveSse: true,
      experimentalLiveSse: false,
    })

    expect(normalized).toEqual({
      url: 'http://localhost:3000/v1/shape',
      experimentalLiveSse: false,
    })
  })
})
