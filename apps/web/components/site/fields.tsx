'use client'

import { useEffect, useRef } from 'react'
import { fitCanvas, MOLTEN, mixHex } from './hooks'

type Pointer = { x: number; y: number; t: number }

/**
 * Runs a canvas loop only while the canvas is on screen. When the pointer has been idle for a while,
 * a wandering point stands in for it, so the field still moves on phones and in screenshots.
 */
function useField(
  build: (w: number, h: number, host: HTMLElement) => void,
  frame: (ctx: CanvasRenderingContext2D, w: number, h: number, px: number, py: number, reduce: boolean) => void,
  wander: (w: number, h: number, t: number) => [number, number],
) {
  const ref = useRef<HTMLCanvasElement>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: build, frame and wander are stable module-level logic per caller
  useEffect(() => {
    const canvas = ref.current
    const host = canvas?.parentElement
    if (!canvas || !host) return
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
    let fit = fitCanvas(canvas)
    build(fit.w, fit.h, host)
    const pointer: Pointer = { x: -999, y: -999, t: 0 }
    let visible = false
    let raf = 0

    function loop(now: number) {
      let { x, y } = pointer
      if (now - pointer.t > 2200) [x, y] = wander(fit.w, fit.h, now / 1000)
      frame(fit.ctx, fit.w, fit.h, x, y, reduce)
      if (visible && !reduce) raf = requestAnimationFrame(loop)
    }
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting
      cancelAnimationFrame(raf)
      if (visible) raf = requestAnimationFrame(loop)
    })
    observer.observe(host)

    function onMove(e: PointerEvent) {
      const rect = (canvas as HTMLCanvasElement).getBoundingClientRect()
      pointer.x = e.clientX - rect.left
      pointer.y = e.clientY - rect.top
      pointer.t = performance.now()
    }
    function onResize() {
      fit = fitCanvas(canvas as HTMLCanvasElement)
      build(fit.w, fit.h, host as HTMLElement)
      if (reduce) requestAnimationFrame(loop)
    }
    host.addEventListener('pointermove', onMove)
    window.addEventListener('resize', onResize)
    // Web fonts move the text, and the hero field keeps off the text, so build again once they load.
    document.fonts.ready.then(onResize)
    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
      host.removeEventListener('pointermove', onMove)
      window.removeEventListener('resize', onResize)
    }
  }, [])
  return ref
}

/** The line boxes of every `data-heat-mask` element in the host, in the host's coordinates, padded so a hot dot never touches a letter. */
function maskBoxes(host: HTMLElement) {
  const origin = host.getBoundingClientRect()
  const range = document.createRange()
  return [...host.querySelectorAll('[data-heat-mask]')].flatMap((el) => {
    range.selectNodeContents(el)
    return [...range.getClientRects()].map((r) => ({
      left: r.left - origin.left - 6,
      right: r.right - origin.left + 6,
      top: r.top - origin.top - 6,
      bottom: r.bottom - origin.top + 6,
    }))
  })
}

/**
 * The hero ground: a dot grid that heats up orange under the cursor and cools back to ink. Dots behind text marked
 * `data-heat-mask` never heat, so the copy stays readable.
 */
export function HeatField() {
  const dots = useRef<{ x: number; y: number; heat: number; cold: boolean }[]>([])
  const ref = useField(
    (w, h, host) => {
      const boxes = maskBoxes(host)
      dots.current = []
      for (let y = 10; y < h; y += 20) {
        for (let x = 10; x < w; x += 20) {
          const cold = boxes.some((b) => x >= b.left && x <= b.right && y >= b.top && y <= b.bottom)
          dots.current.push({ x, y, heat: 0, cold })
        }
      }
    },
    (ctx, w, h, px, py) => {
      ctx.clearRect(0, 0, w, h)
      for (const d of dots.current) {
        const dist = Math.hypot(d.x - px, d.y - py)
        if (!d.cold && dist < 110) d.heat = Math.min(1, d.heat + (1 - dist / 110) * 0.22)
        d.heat *= 0.965
        const r = 1.05 + d.heat * 2.4
        ctx.fillStyle = d.heat > 0.02 ? mixHex('#c9c9c2', MOLTEN, Math.min(1, d.heat * 1.6)) : 'rgba(20,20,19,.2)'
        ctx.fillRect(d.x - r, d.y - r, r * 2, r * 2)
      }
    },
    (w, h, t) => [w * (0.5 + 0.34 * Math.sin(t * 0.37)), h * (0.55 + 0.3 * Math.sin(t * 0.61 + 1))],
  )
  return <canvas ref={ref} aria-hidden className="pointer-events-none absolute inset-0 size-full" />
}

/** The footer ground: a field of arrows that turn to follow the cursor. */
export function ArrowField() {
  const arrows = useRef<{ x: number; y: number; a: number; push: number }[]>([])
  const ref = useField(
    (w, h) => {
      arrows.current = []
      for (let y = 22; y < h; y += 44) for (let x = 22; x < w; x += 44) arrows.current.push({ x, y, a: -0.78, push: 0 })
    },
    (ctx, w, h, px, py, reduce) => {
      ctx.clearRect(0, 0, w, h)
      for (const ar of arrows.current) {
        const dist = Math.hypot(px - ar.x, py - ar.y)
        const target = Math.atan2(py - ar.y, px - ar.x)
        const diff = ((target - ar.a + Math.PI * 3) % (Math.PI * 2)) - Math.PI
        ar.a += reduce ? diff : diff * 0.12
        const near = Math.max(0, 1 - dist / 220)
        ar.push += (near * 10 - ar.push) * 0.15
        ctx.save()
        ctx.translate(ar.x - Math.cos(target) * ar.push, ar.y - Math.sin(target) * ar.push)
        ctx.rotate(ar.a)
        ctx.strokeStyle = near > 0.05 ? mixHex('#b8b8b0', MOLTEN, Math.min(1, near * 1.8)) : 'rgba(20,20,19,.28)'
        ctx.lineWidth = 1.5 + near * 1.2
        ctx.lineCap = 'square'
        ctx.beginPath()
        ctx.moveTo(-8, 0)
        ctx.lineTo(8, 0)
        ctx.moveTo(3, -5)
        ctx.lineTo(8, 0)
        ctx.lineTo(3, 5)
        ctx.stroke()
        ctx.restore()
      }
    },
    (w, h, t) => [w * (0.62 + 0.3 * Math.cos(t * 0.4)), h * (0.45 + 0.35 * Math.sin(t * 0.55))],
  )
  return <canvas ref={ref} aria-hidden className="pointer-events-none absolute inset-0 size-full" />
}
