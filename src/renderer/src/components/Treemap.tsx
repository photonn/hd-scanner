import React, { useRef, useEffect, useCallback } from 'react'
import { squarifiedTreemap } from '../treemap'

export interface FolderNode {
  name: string
  path: string
  size: number
  children: FolderNode[]
}

interface Props {
  root: FolderNode
  onNavigate: (node: FolderNode) => void
}

function formatSize(bytes: number): string {
  if (bytes >= 1e12) return (bytes / 1e12).toFixed(2) + ' TB'
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(2) + ' GB'
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(2) + ' MB'
  if (bytes >= 1e3) return (bytes / 1e3).toFixed(2) + ' KB'
  return bytes + ' B'
}

// A pleasing palette for folder tiles
const PALETTE = [
  '#4e79a7',
  '#f28e2b',
  '#e15759',
  '#76b7b2',
  '#59a14f',
  '#edc948',
  '#b07aa1',
  '#ff9da7',
  '#9c755f',
  '#bab0ac'
]

function colorFor(index: number, depth: number): string {
  const base = PALETTE[index % PALETTE.length]
  // Darken slightly for deeper levels
  const factor = Math.max(0.6, 1 - depth * 0.08)
  return lighten(base, factor)
}

function lighten(hex: string, factor: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const nr = Math.round(r * factor)
  const ng = Math.round(g * factor)
  const nb = Math.round(b * factor)
  return `rgb(${nr},${ng},${nb})`
}

interface RenderNode {
  node: FolderNode
  x: number
  y: number
  width: number
  height: number
  colorIdx: number
  depth: number
}

/**
 * Recursively build a flat list of rectangles to render, subdividing folders
 * whose tiles are large enough to show children.
 */
function buildRects(
  node: FolderNode,
  x: number,
  y: number,
  w: number,
  h: number,
  depth: number,
  colorIdx: number,
  MIN_CHILD_AREA = 600
): RenderNode[] {
  const rects: RenderNode[] = [{ node, x, y, width: w, height: h, colorIdx, depth }]

  const children = node.children.filter((c) => c.size > 0)
  if (children.length === 0 || w * h < MIN_CHILD_AREA) return rects

  const PADDING = 2
  const HEADER = Math.min(18, h * 0.15)
  const innerX = x + PADDING
  const innerY = y + HEADER
  const innerW = w - PADDING * 2
  const innerH = h - HEADER - PADDING

  if (innerW <= 0 || innerH <= 0) return rects

  const layout = squarifiedTreemap(
    children.map((c) => ({ value: c.size })),
    innerX,
    innerY,
    innerW,
    innerH
  )

  for (let i = 0; i < children.length; i++) {
    const r = layout[i]
    if (!r || r.width < 1 || r.height < 1) continue
    const childRects = buildRects(
      children[i],
      r.x,
      r.y,
      r.width,
      r.height,
      depth + 1,
      (colorIdx + i + 1) % PALETTE.length,
      MIN_CHILD_AREA
    )
    rects.push(...childRects)
  }

  return rects
}

const TreemapComponent: React.FC<Props> = ({ root, onNavigate }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rectsRef = useRef<RenderNode[]>([])
  const tooltipRef = useRef<HTMLDivElement>(null)

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const { width, height } = canvas
    ctx.clearRect(0, 0, width, height)

    // Build layout
    const allRects = buildRects(root, 0, 0, width, height, 0, 0)
    rectsRef.current = allRects

    // Draw from deepest to shallowest (painters algorithm)
    const sorted = [...allRects].sort((a, b) => b.depth - a.depth)

    for (const r of sorted) {
      if (r.width < 1 || r.height < 1) continue

      // Fill
      ctx.fillStyle = colorFor(r.colorIdx, r.depth)
      ctx.fillRect(r.x, r.y, r.width, r.height)

      // Border
      ctx.strokeStyle = 'rgba(0,0,0,0.25)'
      ctx.lineWidth = 1
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.width - 1, r.height - 1)

      // Label (only if large enough)
      if (r.width > 40 && r.height > 16) {
        const label = r.node.name
        const sizeLabel = formatSize(r.node.size)
        const fontSize = Math.min(13, Math.max(9, r.height / 5))
        ctx.fillStyle = 'rgba(255,255,255,0.92)'
        ctx.font = `bold ${fontSize}px system-ui, sans-serif`

        const maxWidth = r.width - 8
        const truncated = truncateText(ctx, label, maxWidth)
        ctx.fillText(truncated, r.x + 4, r.y + fontSize + 2)

        if (r.height > 30 && fontSize > 9) {
          ctx.font = `${Math.max(8, fontSize - 2)}px system-ui, sans-serif`
          ctx.fillStyle = 'rgba(255,255,255,0.7)'
          ctx.fillText(sizeLabel, r.x + 4, r.y + fontSize * 2 + 4)
        }
      }
    }
  }, [root])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const observer = new ResizeObserver(() => {
      canvas.width = canvas.offsetWidth
      canvas.height = canvas.offsetHeight
      draw()
    })
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [draw])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.width = canvas.offsetWidth || 800
    canvas.height = canvas.offsetHeight || 600
    draw()
  }, [draw])

  const getNodeAt = useCallback((ex: number, ey: number): RenderNode | null => {
    // Search from deepest (last in array = deepest visible)
    const rects = rectsRef.current
    for (let i = rects.length - 1; i >= 0; i--) {
      const r = rects[i]
      if (ex >= r.x && ex <= r.x + r.width && ey >= r.y && ey <= r.y + r.height) {
        return r
      }
    }
    return null
  }, [])

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      const hit = getNodeAt(x, y)
      if (hit && hit.node !== root && hit.node.children.length > 0) {
        onNavigate(hit.node)
      }
    },
    [getNodeAt, onNavigate, root]
  )

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current
      const tooltip = tooltipRef.current
      if (!canvas || !tooltip) return
      const rect = canvas.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      const hit = getNodeAt(x, y)
      if (hit) {
        tooltip.style.display = 'block'
        tooltip.style.left = `${e.clientX + 12}px`
        tooltip.style.top = `${e.clientY + 12}px`
        tooltip.innerHTML = `<strong>${hit.node.name}</strong><br/>${formatSize(hit.node.size)}<br/><span class="path">${hit.node.path}</span>`
        canvas.style.cursor =
          hit.node !== root && hit.node.children.length > 0 ? 'pointer' : 'default'
      } else {
        tooltip.style.display = 'none'
        canvas.style.cursor = 'default'
      }
    },
    [getNodeAt, root]
  )

  const handleMouseLeave = useCallback(() => {
    const tooltip = tooltipRef.current
    if (tooltip) tooltip.style.display = 'none'
  }, [])

  return (
    <div className="treemap-wrapper">
      <canvas
        ref={canvasRef}
        className="treemap-canvas"
        onClick={handleClick}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      />
      <div ref={tooltipRef} className="treemap-tooltip" />
    </div>
  )
}

function truncateText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text
  const ellipsis = '…'
  let lo = 0
  let hi = text.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (ctx.measureText(text.slice(0, mid) + ellipsis).width <= maxWidth) {
      lo = mid
    } else {
      hi = mid - 1
    }
  }
  return lo === 0 ? '' : text.slice(0, lo) + ellipsis
}

export default TreemapComponent
