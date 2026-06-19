/**
 * Squarified treemap layout algorithm.
 *
 * References:
 *   Bruls, Huizing, van Wijk — "Squarified Treemaps" (2000)
 */

export interface TreemapRect {
  x: number
  y: number
  width: number
  height: number
  /** Index into the original items array */
  index: number
}

export interface TreemapItem {
  value: number
}

/**
 * Compute a squarified treemap layout.
 *
 * @param items  Items with a `value` field (must be sorted descending by value).
 * @param x      Left edge of the bounding box.
 * @param y      Top edge of the bounding box.
 * @param width  Width of the bounding box.
 * @param height Height of the bounding box.
 * @returns      Array of rects, one per item, in original item order.
 */
export function squarifiedTreemap(
  items: TreemapItem[],
  x: number,
  y: number,
  width: number,
  height: number
): TreemapRect[] {
  if (items.length === 0 || width <= 0 || height <= 0) return []

  const total = items.reduce((s, i) => s + i.value, 0)
  if (total === 0) return []

  // Normalise values so they sum to the total area (width * height)
  const area = width * height
  const normalised = items.map((item, index) => ({
    value: (item.value / total) * area,
    index
  }))

  const rects: TreemapRect[] = new Array(items.length)
  layout(normalised, x, y, width, height, rects)
  return rects
}

// ── Internal helpers ──────────────────────────────────────────────────────────

interface NItem {
  value: number
  index: number
}

function layout(
  items: NItem[],
  x: number,
  y: number,
  w: number,
  h: number,
  out: TreemapRect[]
): void {
  if (items.length === 0) return
  if (items.length === 1) {
    out[items[0].index] = { x, y, width: w, height: h, index: items[0].index }
    return
  }

  let start = 0
  let cx = x
  let cy = y
  let cw = w
  let ch = h

  while (start < items.length) {
    const shortSide = Math.min(cw, ch)
    const remaining = items.slice(start)

    // Find the best row (the row that minimises worst-case aspect ratio)
    let rowEnd = start + 1
    let prevWorst = Infinity

    for (let end = start + 1; end <= items.length; end++) {
      const row = items.slice(start, end)
      const worst = worstRatio(row, shortSide)
      if (worst > prevWorst) {
        rowEnd = end - 1
        break
      }
      prevWorst = worst
      rowEnd = end
    }

    const row = items.slice(start, rowEnd)
    placeRow(row, cx, cy, cw, ch, out)

    // Advance the remaining space
    const rowSum = row.reduce((s, i) => s + i.value, 0)
    const totalArea = cw * ch

    if (cw >= ch) {
      // row placed as a vertical strip on the left
      const rowWidth = totalArea > 0 ? rowSum / ch : 0
      cx += rowWidth
      cw -= rowWidth
    } else {
      // row placed as a horizontal strip on the top
      const rowHeight = totalArea > 0 ? rowSum / cw : 0
      cy += rowHeight
      ch -= rowHeight
    }

    start = rowEnd
  }
}

function worstRatio(row: NItem[], shortSide: number): number {
  if (row.length === 0 || shortSide === 0) return Infinity
  const sum = row.reduce((s, i) => s + i.value, 0)
  const maxVal = Math.max(...row.map((i) => i.value))
  const minVal = Math.min(...row.map((i) => i.value))
  if (minVal === 0) return Infinity
  const s2 = shortSide * shortSide
  return Math.max((s2 * maxVal) / (sum * sum), (sum * sum) / (s2 * minVal))
}

function placeRow(
  row: NItem[],
  x: number,
  y: number,
  w: number,
  h: number,
  out: TreemapRect[]
): void {
  const rowSum = row.reduce((s, i) => s + i.value, 0)
  if (rowSum === 0) return

  const isHorizontal = w >= h

  if (isHorizontal) {
    // Strip along the left edge; width = rowSum / h
    const rowWidth = rowSum / h
    let curY = y
    for (const item of row) {
      const cellHeight = h > 0 ? item.value / rowWidth : 0
      out[item.index] = {
        x,
        y: curY,
        width: rowWidth,
        height: cellHeight,
        index: item.index
      }
      curY += cellHeight
    }
  } else {
    // Strip along the top edge; height = rowSum / w
    const rowHeight = rowSum / w
    let curX = x
    for (const item of row) {
      const cellWidth = w > 0 ? item.value / rowHeight : 0
      out[item.index] = {
        x: curX,
        y,
        width: cellWidth,
        height: rowHeight,
        index: item.index
      }
      curX += cellWidth
    }
  }
}
