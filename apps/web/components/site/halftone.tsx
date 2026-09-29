'use client'

import { useEffect, useRef } from 'react'
import { cn } from '@/lib/cn'
import { fitCanvas, INK, MOLTEN, mixHex } from './hooks'

type Cell = { x: number; y: number; r: number; hot: boolean }

const RADIUS = 120
const PUSH = 18

/*
  A photo redrawn as a dot matrix on the page grid. Molten areas become orange dots, the rest ink.
  On first view the dots pour in from the bottom; near the cursor they part, swell and heat up.
*/
export function Halftone({
  src,
  label,
  pitch = 8,
  className,
}: {
  src: string
  label: string
  pitch?: number
  className?: string
}) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
    let cells: Cell[] = []
    let rows = 1
    let size = { w: 0, h: 0 }
    let ctx: CanvasRenderingContext2D | null = null
    let pourStart = 0
    let raf = 0
    let strength = 0
    const pointer = { x: -9999, y: -9999, active: false }
    const img = new Image()

    function sample() {
      const fit = fitCanvas(canvas as HTMLCanvasElement)
      ctx = fit.ctx
      size = { w: fit.w, h: fit.h }
      const cols = Math.ceil(fit.w / pitch)
      rows = Math.ceil(fit.h / pitch)
      const off = document.createElement('canvas')
      off.width = cols
      off.height = rows
      const o = off.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D
      const s = Math.max(cols / img.width, rows / img.height)
      o.drawImage(img, (cols - img.width * s) / 2, (rows - img.height * s) / 2, img.width * s, img.height * s)
      const d = o.getImageData(0, 0, cols, rows).data
      cells = []
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const i = (y * cols + x) * 4
          const [r, g, b] = [d[i], d[i + 1], d[i + 2]]
          const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
          const hot = r > 170 && r - b > 110 && g > 50 && g < 210
          const ink = Math.max(0, (0.93 - lum) / 0.93)
          const radius = hot ? pitch * (0.3 + (0.2 * (r - b)) / 255) : pitch * 0.5 * ink ** 0.8
          if (radius >= 0.45) cells.push({ x: x * pitch + pitch / 2, y: y * pitch + pitch / 2, r: radius, hot })
        }
      }
    }

    function draw(now: number) {
      if (!ctx) return
      const pour = reduce ? 1 : Math.min(1, (now - pourStart) / 1400)
      // ease the cursor's pull in and out so dots settle back instead of snapping
      strength += ((pointer.active ? 1 : 0) - strength) * 0.14
      ctx.clearRect(0, 0, size.w, size.h)
      for (const c of cells) {
        // the level rises from the bottom row to the top
        const rise = (pour * 1.25 - (1 - c.y / size.h)) * 5
        if (rise <= 0) continue
        let x = c.x
        let y = c.y
        let heat = 0
        if (strength > 0.01) {
          const dx = c.x - pointer.x
          const dy = c.y - pointer.y
          const dist = Math.hypot(dx, dy) || 1
          heat = Math.max(0, 1 - dist / RADIUS) * strength
          // molten dots are pushed away from the cursor, like metal parting around a tool
          const push = heat * heat * PUSH
          x += (dx / dist) * push
          y += (dy / dist) * push
        }
        const r = Math.min(pitch * 0.66, c.r * Math.min(1, rise) * (1 + heat * 0.5) + heat * 1.4)
        ctx.fillStyle = c.hot ? MOLTEN : heat > 0.04 ? mixHex(INK, MOLTEN, Math.min(1, heat * 1.4)) : INK
        ctx.beginPath()
        ctx.arc(x, y, r, 0, Math.PI * 2)
        ctx.fill()
      }
      if (pour < 1 || pointer.active || strength > 0.01) raf = requestAnimationFrame(draw)
    }

    function kick() {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(draw)
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && pourStart === 0 && cells.length) {
          pourStart = performance.now()
          kick()
        }
      },
      { threshold: 0.25 },
    )

    img.onload = () => {
      sample()
      observer.observe(canvas)
    }
    img.src = src

    function onMove(e: PointerEvent) {
      const rect = (canvas as HTMLCanvasElement).getBoundingClientRect()
      pointer.x = e.clientX - rect.left
      pointer.y = e.clientY - rect.top
      pointer.active = !reduce
      kick()
    }
    function onLeave() {
      pointer.active = false
      kick()
    }
    function onResize() {
      if (!img.complete) return
      sample()
      kick()
    }
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerleave', onLeave)
    window.addEventListener('resize', onResize)
    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerleave', onLeave)
      window.removeEventListener('resize', onResize)
    }
  }, [src, pitch])

  return <canvas ref={ref} role="img" aria-label={label} className={cn('block aspect-[3/2] w-full', className)} />
}
