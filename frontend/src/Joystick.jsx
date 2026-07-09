import { useRef, useState } from 'react'

// Dev-only analog stick. Emits { heading, speed } while held (heading = radians
// from north, clockwise; speed = 0..1), or null on release.
export default function Joystick({ onVector, accent = '#7CFC9B' }) {
  const baseRef = useRef(null)
  const active = useRef(false)
  const [knob, setKnob] = useState({ x: 0, y: 0 })
  const R = 42 // max knob travel (px)

  const handle = (clientX, clientY) => {
    const b = baseRef.current.getBoundingClientRect()
    const cx = b.left + b.width / 2
    const cy = b.top + b.height / 2
    let dx = clientX - cx
    let dy = clientY - cy
    const mag = Math.hypot(dx, dy)
    if (mag > R) {
      dx = (dx / mag) * R
      dy = (dy / mag) * R
    }
    setKnob({ x: dx, y: dy })
    const speed = Math.min(mag, R) / R
    if (speed < 0.1) {
      onVector(null)
      return
    }
    // screen: +x east, -y north -> heading from north, clockwise
    onVector({ heading: Math.atan2(dx, -dy), speed })
  }

  const start = (e) => {
    active.current = true
    e.currentTarget.setPointerCapture?.(e.pointerId)
    handle(e.clientX, e.clientY)
  }
  const move = (e) => {
    if (active.current) handle(e.clientX, e.clientY)
  }
  const end = () => {
    active.current = false
    setKnob({ x: 0, y: 0 })
    onVector(null)
  }

  return (
    <div
      ref={baseRef}
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      style={{
        width: 108,
        height: 108,
        borderRadius: '50%',
        background: 'rgba(8,11,16,.55)',
        border: '1px solid rgba(255,255,255,.14)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        touchAction: 'none',
        cursor: 'grab',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: '0 4px 16px rgba(0,0,0,.5)',
      }}
    >
      <div
        style={{
          width: 46,
          height: 46,
          borderRadius: '50%',
          background: accent,
          opacity: 0.85,
          transform: `translate(${knob.x}px, ${knob.y}px)`,
          boxShadow: '0 0 12px ' + accent + '99',
          pointerEvents: 'none',
        }}
      />
    </div>
  )
}
