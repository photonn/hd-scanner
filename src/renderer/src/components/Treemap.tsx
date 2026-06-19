import React, { useRef, useEffect, useCallback } from 'react'
import { squarifiedTreemap } from '../treemap'

export interface FolderNode {
  name: string
  path: string
  size: number
  children: FolderNode[]
  errorCount: number
}

interface Props {
  root: FolderNode
  onNavigate: (node: FolderNode) => void
  onContextMenu?: (node: FolderNode, clientX: number, clientY: number) => void
}

function formatSize(bytes: number): string {
  if (bytes >= 1e12) return (bytes / 1e12).toFixed(2) + ' TB'
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(2) + ' GB'
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(2) + ' MB'
  if (bytes >= 1e3) return (bytes / 1e3).toFixed(2) + ' KB'
  return bytes + ' B'
}

// A pleasing palette of solid, distinct colors for folder tiles
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

function colorFor(index: number): string {
  return PALETTE[index % PALETTE.length]
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

const TreemapComponent: React.FC<Props> = ({ root, onNavigate, onContextMenu }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
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

    // Draw from shallowest to deepest so child tiles paint over their parent (painter's algorithm)
    const sorted = [...allRects].sort((a, b) => a.depth - b.depth)

    for (const r of sorted) {
      if (r.width < 1 || r.height < 1) continue

      // Fill
      ctx.fillStyle = colorFor(r.colorIdx)
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
      const wrapper = wrapperRef.current
      if (!canvas || !tooltip || !wrapper) return
      const rect = canvas.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      const hit = getNodeAt(x, y)
      if (hit) {
        tooltip.style.display = 'block'
        tooltip.replaceChildren()

        const titleEl = document.createElement('strong')
        titleEl.textContent = hit.node.name
        const sizeEl = document.createTextNode(formatSize(hit.node.size))
        const pathEl = document.createElement('span')
        pathEl.className = 'path'
        pathEl.textContent = hit.node.path

        tooltip.append(titleEl, document.createElement('br'), sizeEl, document.createElement('br'), pathEl)

        const wrapperRect = wrapper.getBoundingClientRect()
        const tooltipWidth = tooltip.offsetWidth || 200
        const tooltipHeight = tooltip.offsetHeight || 60
        let left = e.clientX + 12
        let top = e.clientY + 12
        if (left + tooltipWidth > wrapperRect.right) left = e.clientX - tooltipWidth - 12
        if (top + tooltipHeight > wrapperRect.bottom) top = e.clientY - tooltipHeight - 12
        tooltip.style.left = `${Math.max(wrapperRect.left, left)}px`
        tooltip.style.top = `${Math.max(wrapperRect.top, top)}px`

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

  const handleContextMenuEvent = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      e.preventDefault()
      const canvas = canvasRef.current
      if (!canvas || !onContextMenu) return
      const rect = canvas.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      const hit = getNodeAt(x, y)
      if (hit) onContextMenu(hit.node, e.clientX, e.clientY)
    },
    [getNodeAt, onContextMenu]
  )

  return (
    <div className="treemap-wrapper" ref={wrapperRef}>
      <canvas
        ref={canvasRef}
        className="treemap-canvas"
        onClick={handleClick}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onContextMenu={handleContextMenuEvent}
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
