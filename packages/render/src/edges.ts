import type { EdgeRoute, EdgeSegment, Port } from '@ascii-erd/layout';
import type { Canvas } from './canvas.js';
import type { Glyphs } from './glyphs.js';

export function drawEdge(canvas: Canvas, edge: EdgeRoute, glyphs: Glyphs): void {
  for (const seg of edge.segments) {
    drawSegment(canvas, seg, glyphs);
  }
  drawCorners(canvas, edge.segments, glyphs);
  drawPortMarker(canvas, edge.parentPort, glyphs);
  drawPortMarker(canvas, edge.childPort, glyphs);
}

function drawSegment(canvas: Canvas, seg: EdgeSegment, glyphs: Glyphs): void {
  if (seg.kind === 'horizontal') {
    const xMin = Math.min(seg.x1, seg.x2);
    const xMax = Math.max(seg.x1, seg.x2);
    for (let x = xMin; x <= xMax; x++) {
      canvas.set(x, seg.y1, mergeSegment(canvas.get(x, seg.y1), glyphs.horizontal, glyphs));
    }
  } else {
    const yMin = Math.min(seg.y1, seg.y2);
    const yMax = Math.max(seg.y1, seg.y2);
    for (let y = yMin; y <= yMax; y++) {
      canvas.set(seg.x1, y, mergeSegment(canvas.get(seg.x1, y), glyphs.vertical, glyphs));
    }
  }
}

// Direction-set merging:
//   - JOIN (shared direction): existing and incoming touch the same edge of
//     the cell, so combine their directions and pick the glyph for the union.
//     Corners upgrade to tees, tees upgrade to cross, etc.
//   - CROSSING (no shared direction, e.g. ─ × │): the vertical wins so the
//     horizontal shows a visible gap at the intersection — the reader's eye
//     traces ─ ─ ─ │ ─ ─ ─ as a horizontal passing through a vertical.
//   - Unrecognized cells (entity text, anything not in our line glyph table)
//     are kept as-is — they were placed deliberately.
function mergeSegment(existing: string | undefined, incoming: string, glyphs: Glyphs): string {
  if (existing === undefined || existing === ' ') return incoming;
  if (existing === incoming) return existing;

  const existingDirs = dirsOf(existing, glyphs);
  const incomingDirs = dirsOf(incoming, glyphs);
  if (existingDirs === null) return existing;
  if (incomingDirs === null) return incoming;

  let shared = false;
  for (const d of existingDirs) {
    if (incomingDirs.has(d)) {
      shared = true;
      break;
    }
  }

  if (shared) {
    const merged = new Set<Dir>([...existingDirs, ...incomingDirs]);
    return glyphForDirs(merged, glyphs);
  }

  // Pure crossing: vertical wins, horizontal gets the gap.
  if (existingDirs.has('N') || existingDirs.has('S')) return existing;
  return incoming;
}

type Dir = 'N' | 'S' | 'E' | 'W';

// In ASCII mode the corners, tees, and cross all collapse to '+', so dirsOf
// returns whichever case matches first. That's fine: every merge result also
// renders as '+' in ASCII, so the visual output stays correct even though the
// direction set is an under-approximation.
function dirsOf(glyph: string, glyphs: Glyphs): Set<Dir> | null {
  switch (glyph) {
    case glyphs.horizontal:
      return new Set(['E', 'W']);
    case glyphs.vertical:
      return new Set(['N', 'S']);
    case glyphs.cornerTL:
      return new Set(['E', 'S']);
    case glyphs.cornerTR:
      return new Set(['W', 'S']);
    case glyphs.cornerBL:
      return new Set(['E', 'N']);
    case glyphs.cornerBR:
      return new Set(['W', 'N']);
    case glyphs.teeE:
      return new Set(['E', 'N', 'S']);
    case glyphs.teeW:
      return new Set(['W', 'N', 'S']);
    case glyphs.teeN:
      return new Set(['E', 'N', 'W']);
    case glyphs.teeS:
      return new Set(['E', 'S', 'W']);
    case glyphs.cross:
      return new Set(['N', 'S', 'E', 'W']);
    default:
      return null;
  }
}

function glyphForDirs(dirs: Set<Dir>, glyphs: Glyphs): string {
  const n = dirs.has('N');
  const s = dirs.has('S');
  const e = dirs.has('E');
  const w = dirs.has('W');
  if (n && s && e && w) return glyphs.cross;
  if (n && s && e) return glyphs.teeE;
  if (n && s && w) return glyphs.teeW;
  if (n && e && w) return glyphs.teeN;
  if (s && e && w) return glyphs.teeS;
  if (e && s) return glyphs.cornerTL;
  if (w && s) return glyphs.cornerTR;
  if (e && n) return glyphs.cornerBL;
  if (w && n) return glyphs.cornerBR;
  if (n || s) return glyphs.vertical;
  return glyphs.horizontal;
}

// Walk consecutive segment pairs and place a corner glyph at each junction.
// Direction the previous segment came from + direction the next segment goes
// determines the corner's two arms — works for any segment count (Z-shape
// has 2 junctions, multi-hop U-shape has 4, etc.).
function drawCorners(canvas: Canvas, segments: EdgeSegment[], glyphs: Glyphs): void {
  for (let i = 0; i < segments.length - 1; i++) {
    const prev = segments[i]!;
    const next = segments[i + 1]!;
    const corner = glyphForDirs(
      new Set<Dir>([directionAtEnd(prev), directionAtStart(next)]),
      glyphs,
    );
    canvas.set(next.x1, next.y1, corner);
  }
}

// Direction the segment came FROM at the junction (the arm of the corner
// glyph that points back toward the previous segment's body). For
// zero-length segments we default to the "natural" direction for our
// pipeline: edges always flow left-to-right, so a degenerate H1 is
// conceptually east-going (came from west).
function directionAtEnd(seg: EdgeSegment): Dir {
  if (seg.kind === 'horizontal') return seg.x2 < seg.x1 ? 'E' : 'W';
  return seg.y2 < seg.y1 ? 'S' : 'N';
}

// Direction the segment travels AWAY from the junction toward its endpoint.
function directionAtStart(seg: EdgeSegment): Dir {
  if (seg.kind === 'horizontal') return seg.x2 < seg.x1 ? 'W' : 'E';
  return seg.y2 < seg.y1 ? 'N' : 'S';
}

function drawPortMarker(canvas: Canvas, port: Port, glyphs: Glyphs): void {
  switch (port.side) {
    case 'right':
      canvas.set(port.x, port.y, glyphs.teeE);
      break;
    case 'left':
      canvas.set(port.x, port.y, glyphs.teeW);
      break;
    case 'top':
      canvas.set(port.x, port.y, glyphs.teeN);
      break;
    case 'bottom':
      canvas.set(port.x, port.y, glyphs.teeS);
      break;
  }
}
