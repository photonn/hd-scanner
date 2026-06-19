import { describe, it, expect } from 'vitest'
import { squarifiedTreemap } from '../renderer/src/treemap'

describe('squarifiedTreemap', () => {
  it('returns an empty array for empty input', () => {
    const result = squarifiedTreemap([], 0, 0, 100, 100)
    expect(result).toHaveLength(0)
  })

  it('returns an empty array when width or height is zero', () => {
    expect(squarifiedTreemap([{ value: 10 }], 0, 0, 0, 100)).toHaveLength(0)
    expect(squarifiedTreemap([{ value: 10 }], 0, 0, 100, 0)).toHaveLength(0)
  })

  it('returns one full-size rect for a single item', () => {
    const result = squarifiedTreemap([{ value: 42 }], 5, 10, 200, 150)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ x: 5, y: 10, width: 200, height: 150, index: 0 })
  })

  it('total area of rects equals bounding-box area', () => {
    const items = [{ value: 6 }, { value: 3 }, { value: 2 }, { value: 1 }]
    const W = 100
    const H = 80
    const rects = squarifiedTreemap(items, 0, 0, W, H)
    const totalArea = rects.reduce((s, r) => s + r.width * r.height, 0)
    expect(totalArea).toBeCloseTo(W * H, 0)
  })

  it('preserves item-index mapping correctly', () => {
    const items = [{ value: 10 }, { value: 5 }, { value: 3 }]
    const rects = squarifiedTreemap(items, 0, 0, 100, 100)
    expect(rects).toHaveLength(3)
    const indices = rects.map((r) => r.index).sort((a, b) => a - b)
    expect(indices).toEqual([0, 1, 2])
  })

  it('larger items get larger rects', () => {
    const items = [{ value: 100 }, { value: 10 }]
    const rects = squarifiedTreemap(items, 0, 0, 200, 100)
    const areaOf = (i: number) => rects.find((r) => r.index === i)!
    const bigArea = areaOf(0).width * areaOf(0).height
    const smallArea = areaOf(1).width * areaOf(1).height
    expect(bigArea).toBeGreaterThan(smallArea)
  })

  it('rects areas are proportional to item values', () => {
    const items = [{ value: 3 }, { value: 1 }]
    const rects = squarifiedTreemap(items, 0, 0, 200, 100)
    const areaOf = (i: number) => {
      const r = rects.find((r) => r.index === i)!
      return r.width * r.height
    }
    expect(areaOf(0) / areaOf(1)).toBeCloseTo(3, 0)
  })

  it('handles all-zero values gracefully', () => {
    const result = squarifiedTreemap([{ value: 0 }, { value: 0 }], 0, 0, 100, 100)
    expect(result).toHaveLength(0)
  })

  it('correctly offsets rects when origin is non-zero', () => {
    const items = [{ value: 1 }]
    const result = squarifiedTreemap(items, 50, 75, 100, 80)
    expect(result[0].x).toBe(50)
    expect(result[0].y).toBe(75)
  })

  it('produces non-negative width and height for all rects', () => {
    const items = Array.from({ length: 20 }, (_, i) => ({ value: i + 1 }))
    const rects = squarifiedTreemap(items, 0, 0, 800, 600)
    for (const r of rects) {
      expect(r.width).toBeGreaterThanOrEqual(0)
      expect(r.height).toBeGreaterThanOrEqual(0)
    }
  })

  it('handles a single item with zero value amongst non-zero', () => {
    const items = [{ value: 10 }, { value: 0 }, { value: 5 }]
    const rects = squarifiedTreemap(items, 0, 0, 100, 100)
    const totalArea = rects.reduce((s, r) => s + r.width * r.height, 0)
    expect(totalArea).toBeCloseTo(100 * 100, 0)
  })
})
