import { type JSX, useMemo } from 'react'
import qrcode from 'qrcode-generator'

/** An address for the phone in the room, since the television has no browser. */

/**
 * A QR code, drawn as SVG.
 *
 * Deliberately black on white with a four-module quiet zone, ignoring the dark
 * theme around it: a phone camera needs the contrast and the light margin, and
 * a QR rendered in the UI's own palette is often simply unreadable.
 *
 * The modules are emitted as one path rather than a few hundred <rect>s, and
 * `crispEdges` keeps the cells from being antialiased into each other.
 */
export function QrCode({ value, size = 240 }: { value: string; size?: number }): JSX.Element {
  const { path, moduleCount } = useMemo(() => {
    // Type 0 auto-sizes; 'M' tolerates ~15% damage, which is the usual choice
    // for something displayed on a screen rather than printed.
    const qr = qrcode(0, 'M')
    qr.addData(value)
    qr.make()

    const count = qr.getModuleCount()
    let d = ''
    for (let row = 0; row < count; row += 1) {
      for (let col = 0; col < count; col += 1) {
        if (qr.isDark(row, col)) d += `M${col} ${row}h1v1h-1z`
      }
    }
    return { path: d, moduleCount: count }
  }, [value])

  const quietZone = 4
  const span = moduleCount + quietZone * 2

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${span} ${span}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label="QR code"
    >
      <rect width={span} height={span} fill="#ffffff" />
      <path d={path} fill="#000000" transform={`translate(${quietZone} ${quietZone})`} />
    </svg>
  )
}

/**
 * A web address to open away from the television.
 *
 * The QR code is the control, not the decoration: RomMix is driven from a sofa,
 * where a phone is the browser that is actually to hand — and under gamescope
 * there is frequently no other one to open at all. The address is printed under
 * it for anyone typing it somewhere else.
 */
export function ScanToOpen({ url, size = 200 }: { url: string; size?: number }): JSX.Element {
  return (
    <>
      <div className="pair-qr">
        <QrCode value={url} size={size} />
      </div>
      <p className="muted" style={{ textAlign: 'center', wordBreak: 'break-all' }}>
        {url}
      </p>
    </>
  )
}
