import type { Column, Entity } from '@ascii-erd/parser';
import type { Canvas } from './canvas.js';
import type { Glyphs } from './glyphs.js';

export function drawEntity(
  canvas: Canvas,
  entity: Entity,
  x: number,
  y: number,
  width: number,
  glyphs: Glyphs,
): void {
  const innerWidth = width - 4;
  const bottomY = y + 3 + entity.columns.length;

  hLine(canvas, x, y, width, glyphs.horizontal, glyphs.cornerTL, glyphs.cornerTR);
  // Title centered; columns left-aligned (left alignment makes columns easier
  // to scan, centering the title gives the box a clear visual focus).
  textLine(canvas, x, y + 1, width, padCenter(entity.name, innerWidth), glyphs.vertical);
  hLine(canvas, x, y + 2, width, glyphs.horizontal, glyphs.teeE, glyphs.teeW);
  entity.columns.forEach((col, i) => {
    const rowY = y + 3 + i;
    textLine(canvas, x, rowY, width, formatColumnRow(col, innerWidth), glyphs.vertical);
    // PK marker in the otherwise-blank left-pad cell. Costs no width and
    // doesn't conflict with edge port markers (those live on the border
    // at x and x+width-1).
    if (col.pk) canvas.set(x + 1, rowY, glyphs.pkMarker);
  });
  hLine(canvas, x, bottomY, width, glyphs.horizontal, glyphs.cornerBL, glyphs.cornerBR);
}

function hLine(
  canvas: Canvas,
  x: number,
  y: number,
  width: number,
  fill: string,
  leftCap: string,
  rightCap: string,
): void {
  canvas.set(x, y, leftCap);
  for (let i = 1; i < width - 1; i++) canvas.set(x + i, y, fill);
  canvas.set(x + width - 1, y, rightCap);
}

function textLine(
  canvas: Canvas,
  x: number,
  y: number,
  width: number,
  paddedText: string,
  vertical: string,
): void {
  canvas.set(x, y, vertical);
  canvas.setRow(x + 2, y, paddedText);
  canvas.set(x + width - 1, y, vertical);
}

function padRight(s: string, width: number): string {
  if (s.length >= width) return s.slice(0, width);
  return s + ' '.repeat(width - s.length);
}

// Format one column row's text. Right-aligns the type so types form a column
// on the right edge — `name<...spaces...>type`. Empty col.type (when --no-types
// strips them at the IR level) renders just the left-aligned name.
function formatColumnRow(col: Column, innerWidth: number): string {
  if (!col.type) return padRight(col.name, innerWidth);
  const gap = innerWidth - col.name.length - col.type.length;
  if (gap < 1) return padRight(`${col.name} ${col.type}`, innerWidth);
  return col.name + ' '.repeat(gap) + col.type;
}

function padCenter(s: string, width: number): string {
  if (s.length >= width) return s.slice(0, width);
  const total = width - s.length;
  const left = Math.floor(total / 2);
  const right = total - left;
  return ' '.repeat(left) + s + ' '.repeat(right);
}
