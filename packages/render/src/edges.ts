import type { EdgeRoute, EdgeSegment, Port } from '@ascii-erd/layout';
import type { Canvas } from './canvas.js';
import type { Glyphs } from './glyphs.js';

export function drawEdge(canvas: Canvas, edge: EdgeRoute, glyphs: Glyphs): void {
  for (const seg of edge.segments) {
    drawSegment(canvas, seg, glyphs);
  }
  // Z-shape: overwrite the segment-junction cells with corner glyphs.
  if (edge.segments.length === 3) {
    drawCorners(canvas, edge.segments, glyphs);
  }
  // Port markers go last so they overwrite the entity border that the box
  // step drew.
  drawPortMarker(canvas, edge.parentPort, glyphs);
  drawPortMarker(canvas, edge.childPort, glyphs);
}

function drawSegment(canvas: Canvas, seg: EdgeSegment, glyphs: Glyphs): void {
  if (seg.kind === 'horizontal') {
    const xMin = Math.min(seg.x1, seg.x2);
    const xMax = Math.max(seg.x1, seg.x2);
    for (let x = xMin; x <= xMax; x++) canvas.set(x, seg.y1, glyphs.horizontal);
  } else {
    const yMin = Math.min(seg.y1, seg.y2);
    const yMax = Math.max(seg.y1, seg.y2);
    for (let y = yMin; y <= yMax; y++) canvas.set(seg.x1, y, glyphs.vertical);
  }
}

function drawCorners(canvas: Canvas, segments: EdgeSegment[], glyphs: Glyphs): void {
  const v = segments[1]!;
  const goingDown = v.y2 > v.y1;
  // Parent-side junction: arm enters from west (from H1), exits south or north.
  //   going down  → west + south = ┐ (cornerTR)
  //   going up    → west + north = ┘ (cornerBR)
  // Child-side junction: arm enters from north or south, exits east (toward H2).
  //   going down  → north + east = └ (cornerBL)
  //   going up    → south + east = ┌ (cornerTL)
  canvas.set(v.x1, v.y1, goingDown ? glyphs.cornerTR : glyphs.cornerBR);
  canvas.set(v.x2, v.y2, goingDown ? glyphs.cornerBL : glyphs.cornerTL);
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
