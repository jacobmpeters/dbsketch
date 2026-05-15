import type { Entity } from '@ascii-erd/parser';
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
  textLine(canvas, x, y + 1, width, entity.name, glyphs.vertical, innerWidth);
  hLine(canvas, x, y + 2, width, glyphs.horizontal, glyphs.teeE, glyphs.teeW);
  entity.columns.forEach((col, i) => {
    textLine(canvas, x, y + 3 + i, width, `${col.name} ${col.type}`, glyphs.vertical, innerWidth);
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
  text: string,
  vertical: string,
  innerWidth: number,
): void {
  canvas.set(x, y, vertical);
  canvas.setRow(x + 2, y, padRight(text, innerWidth));
  canvas.set(x + width - 1, y, vertical);
}

function padRight(s: string, width: number): string {
  if (s.length >= width) return s.slice(0, width);
  return s + ' '.repeat(width - s.length);
}
