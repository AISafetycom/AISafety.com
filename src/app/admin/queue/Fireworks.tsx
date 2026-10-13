'use client'

/*
  Fireworks over the whole page when the last item on a tab is decided
  (Bryce, 13 Oct 2026: "Let's make a fun 'You're done!' with fireworks or
  something when I finish a tab"). A canvas laid over everything that
  takes no clicks; a handful of rockets go up and burst, then it calls
  `onDone`. With reduced motion asked for, nothing is drawn.
*/

import { useEffect, useRef } from 'react'
import styles from './queue.module.css'

// The Queue's own colours, read off the page: teal, amber, then coral.
const COLOR_VARS = ['--q-accent', '--q-warn', '--q-danger']
// When each rocket goes up, in seconds from the start.
const LAUNCHES = [0, 0.3, 0.55, 0.9, 1.2, 1.5, 1.9, 2.3]
const GRAVITY = 260 // px/s²

interface Rocket {
  x: number
  y: number
  vy: number
  burstAt: number
  color: string
}

interface Spark {
  x: number
  y: number
  vx: number
  vy: number
  age: number
  life: number
  color: string
  size: number
}

export default function Fireworks({ onDone }: { onDone: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const doneRef = useRef(onDone)
  doneRef.current = onDone

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (
      !canvas ||
      !ctx ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      doneRef.current()
      return
    }
    const css = getComputedStyle(canvas)
    const colors = COLOR_VARS.map(v => css.getPropertyValue(v).trim())
    const glint = css.getPropertyValue('--q-text').trim()
    const dpr = window.devicePixelRatio || 1
    let w = 0
    let h = 0
    const size = () => {
      w = window.innerWidth
      h = window.innerHeight
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    size()
    window.addEventListener('resize', size)

    const rand = (a: number, b: number) => a + Math.random() * (b - a)
    const rockets: Rocket[] = []
    const sparks: Spark[] = []
    let launched = 0
    let elapsed = 0
    let last = performance.now()
    let frame = 0

    const burst = (r: Rocket) => {
      const count = Math.round(rand(70, 100))
      const power = rand(170, 300) * Math.min(1.3, Math.max(0.7, w / 1400))
      for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2 + rand(-0.05, 0.05)
        const speed = power * rand(0.35, 1)
        sparks.push({
          x: r.x,
          y: r.y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          age: 0,
          life: rand(1, 1.7),
          // A few pale glints among each burst's colour.
          color: Math.random() < 0.15 ? glint : r.color,
          size: rand(1.4, 2.4),
        })
      }
    }

    const tick = (now: number) => {
      // Capped so a tab left in the background doesn't jump on return.
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      elapsed += dt

      while (launched < LAUNCHES.length && elapsed >= LAUNCHES[launched]) {
        const x = rand(0.15, 0.85) * w
        const burstAt = rand(0.15, 0.45) * h
        rockets.push({
          x,
          y: h,
          // Fast enough to reach its height in about a second.
          vy: -(h - burstAt) * rand(0.95, 1.15),
          burstAt,
          color: colors[launched % colors.length],
        })
        launched++
      }

      // The last frame fades rather than clears, which leaves trails.
      ctx.globalCompositeOperation = 'destination-out'
      ctx.fillStyle = 'rgba(0, 0, 0, 0.22)'
      ctx.fillRect(0, 0, w, h)
      ctx.globalCompositeOperation = 'lighter'

      for (let i = rockets.length - 1; i >= 0; i--) {
        const r = rockets[i]
        const y0 = r.y
        r.y += r.vy * dt
        ctx.strokeStyle = r.color
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(r.x, y0 + 6)
        ctx.lineTo(r.x, r.y)
        ctx.stroke()
        if (r.y <= r.burstAt) {
          burst(r)
          rockets.splice(i, 1)
        }
      }

      const drag = Math.pow(0.35, dt)
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i]
        s.age += dt
        if (s.age >= s.life) {
          sparks.splice(i, 1)
          continue
        }
        s.vx *= drag
        s.vy = s.vy * drag + GRAVITY * dt
        s.x += s.vx * dt
        s.y += s.vy * dt
        // Bright, then fading, with a twinkle near the end.
        const left = 1 - s.age / s.life
        const twinkle = left < 0.4 && Math.random() < 0.3 ? 0.3 : 1
        ctx.globalAlpha = Math.min(1, left * 1.6) * twinkle
        ctx.fillStyle = s.color
        ctx.beginPath()
        ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1

      if (launched >= LAUNCHES.length && !rockets.length && !sparks.length) {
        doneRef.current()
        return
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', size)
    }
  }, [])

  return <canvas ref={canvasRef} className={styles.fireworks} aria-hidden />
}
