'use client'

import { type RefObject, useEffect, useState } from 'react'

export function useReducedMotion() {
  const [reduce, setReduce] = useState(false)
  useEffect(() => {
    const query = matchMedia('(prefers-reduced-motion: reduce)')
    setReduce(query.matches)
    const onChange = () => setReduce(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  return reduce
}

export function useInView(ref: RefObject<Element | null>, threshold = 0.3) {
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold })
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref, threshold])
  return inView
}

/** Sizes a canvas to its box at the device pixel ratio (capped at 2) and returns a context in CSS pixels. */
export function fitCanvas(canvas: HTMLCanvasElement) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const rect = canvas.getBoundingClientRect()
  canvas.width = Math.max(1, Math.round(rect.width * dpr))
  canvas.height = Math.max(1, Math.round(rect.height * dpr))
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  return { ctx, w: rect.width, h: rect.height }
}

export const MOLTEN = '#ff8000'
export const INK = '#141413'

export function mixHex(a: string, b: string, t: number) {
  const pa = hexToRgb(a)
  const pb = hexToRgb(b)
  return `rgb(${pa.map((v, i) => Math.round(v + (pb[i] - v) * t)).join(',')})`
}

function hexToRgb(hex: string) {
  const n = Number.parseInt(hex.slice(1), 16)
  return [n >> 16, (n >> 8) & 255, n & 255]
}
