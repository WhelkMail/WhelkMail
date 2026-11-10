#!/usr/bin/env node
/**
 * Generate the PNG notification assets from the WhelkMail shell mark.
 *
 * The logo is stroke-only SVG, so it can be rasterised exactly: a pixel is
 * inside the stroke when its distance from the flattened path is at most half
 * the stroke width. Round caps and joins are the same distance metric, which is
 * why no extra geometry is needed.
 *
 * Android does not render SVG for `badge`: it masks the image into a monochrome
 * silhouette of about 96x96 physical pixels, so the status bar icon has to be a
 * bitmap. The `icon` is the large image in the expanded notification and is also
 * safer as a PNG.
 *
 * Run with: npm run icons
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const BRAND = [197, 34, 31]
const CREAM = [255, 247, 242]

/** The mark from public/whelkmail-logo.svg, in its 64x64 coordinate space. */
const MARK_STROKES = [
  {
    width: 4.5,
    d: 'M43 12c9 1 15 9 14 18-1 9-9 15-18 14-8-1-14-8-14-16 0-7 6-13 13-13 6 0 11 5 11 11 0 5-4 9-9 9-4 0-7-3-7-7',
  },
  {
    width: 4.5,
    d: 'M31 36 13 58c-1.5 2 .5 4.5 3 3.5L35 47',
  },
  {
    width: 3,
    d: 'M53 22c-7 1-13 4-18 9M56 31c-8 2-15 6-20 12',
  },
]

const crcTable = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[index] = value >>> 0
  }
  return table
})()

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([length, body, crc])
}

function encodePng(size, pixels) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8 // bit depth
  header[9] = 6 // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (size * 4 + 1)
    raw[rowStart] = 0 // no filter
    pixels.copy(raw, rowStart + 1, y * size * 4, (y + 1) * size * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/* ------------------------------------------------------------------ */
/* Minimal SVG path parser (M, L, H, V, C, S, Q, T, Z + relative forms) */
/* ------------------------------------------------------------------ */

const PARAM_COUNTS = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7 }
const CURVE_STEPS = 32

function cubicPoints(p0, p1, p2, p3) {
  const points = []
  for (let step = 1; step <= CURVE_STEPS; step += 1) {
    const t = step / CURVE_STEPS
    const mt = 1 - t
    const a = mt * mt * mt
    const b = 3 * mt * mt * t
    const c = 3 * mt * t * t
    const d = t * t * t
    points.push([
      a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
      a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
    ])
  }
  return points
}

function quadPoints(p0, p1, p2) {
  const points = []
  for (let step = 1; step <= CURVE_STEPS; step += 1) {
    const t = step / CURVE_STEPS
    const mt = 1 - t
    points.push([
      mt * mt * p0[0] + 2 * mt * t * p1[0] + t * t * p2[0],
      mt * mt * p0[1] + 2 * mt * t * p1[1] + t * t * p2[1],
    ])
  }
  return points
}

/** Flatten a path into polylines of absolute points. */
function flattenPath(d) {
  const tokens = d.match(/[MmLlHhVvCcSsQqTtAaZz]|-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? []
  const polylines = []
  let current = []
  let x = 0
  let y = 0
  let startX = 0
  let startY = 0
  let lastCubicControl = null
  let lastQuadControl = null
  let command = ''
  let index = 0

  const startSubpath = (px, py) => {
    if (current.length > 1) {
      polylines.push(current)
    }
    current = [[px, py]]
  }
  const lineTo = (px, py) => {
    current.push([px, py])
    x = px
    y = py
    lastCubicControl = null
    lastQuadControl = null
  }

  while (index < tokens.length) {
    if (/^[A-Za-z]$/.test(tokens[index])) {
      command = tokens[index]
      index += 1
      if (command === 'Z' || command === 'z') {
        if (current.length > 1) {
          current.push([startX, startY])
        }
        polylines.push(current)
        current = []
        x = startX
        y = startY
        lastCubicControl = null
        lastQuadControl = null
        command = ''
        continue
      }
    }
    if (!command) {
      break
    }
    const upper = command.toUpperCase()
    const relative = command !== upper
    const count = PARAM_COUNTS[upper]
    if (!count || index + count > tokens.length) {
      if (!count) {
        command = ''
        continue
      }
      break
    }
    const args = tokens.slice(index, index + count).map(Number)
    index += count
    const abs = (px, py) => (relative ? [x + px, y + py] : [px, py])

    if (upper === 'M') {
      const [px, py] = abs(args[0], args[1])
      startSubpath(px, py)
      x = px
      y = py
      startX = px
      startY = py
      lastCubicControl = null
      lastQuadControl = null
      command = relative ? 'l' : 'L'
      continue
    }
    if (upper === 'L') {
      const [px, py] = abs(args[0], args[1])
      lineTo(px, py)
      continue
    }
    if (upper === 'H') {
      lineTo(relative ? x + args[0] : args[0], y)
      continue
    }
    if (upper === 'V') {
      lineTo(x, relative ? y + args[0] : args[0])
      continue
    }
    if (upper === 'C' || upper === 'S') {
      let c1
      let c2
      let end
      if (upper === 'C') {
        c1 = abs(args[0], args[1])
        c2 = abs(args[2], args[3])
        end = abs(args[4], args[5])
      } else {
        c1 = lastCubicControl ? [2 * x - lastCubicControl[0], 2 * y - lastCubicControl[1]] : [x, y]
        c2 = abs(args[0], args[1])
        end = abs(args[2], args[3])
      }
      for (const point of cubicPoints([x, y], c1, c2, end)) {
        current.push(point)
      }
      lastCubicControl = c2
      lastQuadControl = null
      x = end[0]
      y = end[1]
      continue
    }
    if (upper === 'Q' || upper === 'T') {
      let control
      let end
      if (upper === 'Q') {
        control = abs(args[0], args[1])
        end = abs(args[2], args[3])
      } else {
        control = lastQuadControl ? [2 * x - lastQuadControl[0], 2 * y - lastQuadControl[1]] : [x, y]
        end = abs(args[0], args[1])
      }
      for (const point of quadPoints([x, y], control, end)) {
        current.push(point)
      }
      lastQuadControl = control
      lastCubicControl = null
      x = end[0]
      y = end[1]
      continue
    }
    // Arcs are not used by the mark; treat them as a straight segment.
    const [px, py] = abs(args[5], args[6])
    lineTo(px, py)
  }
  if (current.length > 1) {
    polylines.push(current)
  }
  return polylines
}

const buildSegments = (strokes) =>
  strokes.flatMap(({ width, d }) =>
    flattenPath(d).flatMap((polyline) =>
      polyline.slice(1).map((point, index) => ({
        x1: polyline[index][0],
        y1: polyline[index][1],
        x2: point[0],
        y2: point[1],
        width,
      })),
    ),
  )

const STROKE_SEGMENTS = buildSegments(MARK_STROKES)
// The decorative hairlines (3 units) turn into noise at status bar size, so the
// badge keeps only the two main strokes: a simplified variant of the mark.
const BADGE_SEGMENTS = buildSegments(MARK_STROKES.filter((stroke) => stroke.width >= 4.5))

/** Bounding box of the stroked mark, stroke width included. */
const MARK_BOUNDS = (() => {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const segment of STROKE_SEGMENTS) {
    const half = segment.width / 2
    minX = Math.min(minX, segment.x1 - half, segment.x2 - half)
    minY = Math.min(minY, segment.y1 - half, segment.y2 - half)
    maxX = Math.max(maxX, segment.x1 + half, segment.x2 + half)
    maxY = Math.max(maxY, segment.y1 + half, segment.y2 + half)
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY }
})()

/**
 * Fit the mark inside the 100x100 frame with equal padding on every side.
 * Using the real bounds keeps the shell centred instead of relying on the
 * viewBox coordinates, which have empty margins.
 */
function markTransform(padding) {
  const available = 100 - padding * 2
  const scale = available / Math.max(MARK_BOUNDS.width, MARK_BOUNDS.height)
  const offsetX = (100 - MARK_BOUNDS.width * scale) / 2 - MARK_BOUNDS.minX * scale
  const offsetY = (100 - MARK_BOUNDS.height * scale) / 2 - MARK_BOUNDS.minY * scale
  return { scale, offsetX, offsetY }
}

function distanceToStroke(segments, px, py, widthBoost) {
  let best = Infinity
  for (const segment of segments) {
    const dx = segment.x2 - segment.x1
    const dy = segment.y2 - segment.y1
    const lengthSquared = dx * dx + dy * dy
    const t =
      lengthSquared === 0
        ? 0
        : Math.max(
            0,
            Math.min(1, ((px - segment.x1) * dx + (py - segment.y1) * dy) / lengthSquared),
          )
    const cx = segment.x1 + t * dx
    const cy = segment.y1 + t * dy
    const distance = Math.hypot(px - cx, py - cy) - (segment.width * widthBoost) / 2
    if (distance < best) {
      best = distance
    }
  }
  return best
}

/**
 * @param {number} size output size in px
 * @param {(x: number, y: number) => number[] | null} paint
 */
function render(size, paint) {
  const pixels = Buffer.alloc(size * size * 4)
  const samples = 3
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0
      let g = 0
      let b = 0
      let covered = 0
      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const px = ((x + (sx + 0.5) / samples) / size) * 100
          const py = ((y + (sy + 0.5) / samples) / size) * 100
          const sample = paint(px, py)
          if (sample) {
            r += sample[0]
            g += sample[1]
            b += sample[2]
            covered += 1
          }
        }
      }
      const total = samples * samples
      const offset = (y * size + x) * 4
      if (covered === 0) {
        continue
      }
      pixels[offset] = Math.round(r / covered)
      pixels[offset + 1] = Math.round(g / covered)
      pixels[offset + 2] = Math.round(b / covered)
      pixels[offset + 3] = Math.round((covered / total) * 255)
    }
  }
  return encodePng(size, pixels)
}

// Status bar badge: white monochrome silhouette, transparent background.
// The stroke is boosted because Android renders the badge at roughly 24dp.
const BADGE_FIT = markTransform(5)
const badge = render(96, (px, py) => {
  const gx = (px - BADGE_FIT.offsetX) / BADGE_FIT.scale
  const gy = (py - BADGE_FIT.offsetY) / BADGE_FIT.scale
  return distanceToStroke(BADGE_SEGMENTS, gx, gy, 1.2) <= 0 ? [255, 255, 255] : null
})

// Large notification icon: brand rounded square with the cream shell mark.
const ICON_FIT = markTransform(26)
const icon = render(192, (px, py) => {
  const radius = 22
  const closestX = Math.min(Math.max(px, radius), 100 - radius)
  const closestY = Math.min(Math.max(py, radius), 100 - radius)
  const insideSquare =
    Math.hypot(px - closestX, py - closestY) <= radius ||
    (px >= radius && px <= 100 - radius) ||
    (py >= radius && py <= 100 - radius)
  if (!insideSquare) {
    return null
  }
  const gx = (px - ICON_FIT.offsetX) / ICON_FIT.scale
  const gy = (py - ICON_FIT.offsetY) / ICON_FIT.scale
  return distanceToStroke(STROKE_SEGMENTS, gx, gy, 1) <= 0 ? CREAM : BRAND
})

writeFileSync(join(root, 'public', 'notification-badge.png'), badge)
writeFileSync(join(root, 'public', 'notification-icon.png'), icon)
console.log('wrote public/notification-badge.png (96x96) and public/notification-icon.png (192x192)')
