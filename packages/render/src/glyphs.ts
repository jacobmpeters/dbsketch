// Tee names use the direction the perpendicular arm points (E/W/N/S), not the
// position on a box. This avoids confusion in port-marker code, where the right
// border of a box needs a tee whose arm points east (into the channel).
export interface Glyphs {
  cornerTL: string;
  cornerTR: string;
  cornerBL: string;
  cornerBR: string;
  horizontal: string;
  vertical: string;
  teeE: string;
  teeW: string;
  teeN: string;
  teeS: string;
  cross: string;
  // Single-character marker for PK rows, written into the otherwise-blank
  // left-pad cell. Subtle enough to scan past, distinct enough to spot.
  pkMarker: string;
}

export const ASCII: Glyphs = {
  cornerTL: '+',
  cornerTR: '+',
  cornerBL: '+',
  cornerBR: '+',
  horizontal: '-',
  vertical: '|',
  teeE: '+',
  teeW: '+',
  teeN: '+',
  teeS: '+',
  cross: '+',
  pkMarker: '*',
};

// Rounded corners (╭ ╮ ╰ ╯) read softer than the sharp box-drawing
// variants in modern terminals and renders well in code editors,
// docs sites, and browsers. The straight, tee, and cross glyphs stay
// sharp — only the four L-corners change. Used for both entity box
// corners and edge L-bends since the render path treats them
// identically. Falls back to --ascii for environments where the
// rounded variants render poorly.
export const UNICODE: Glyphs = {
  cornerTL: '╭',
  cornerTR: '╮',
  cornerBL: '╰',
  cornerBR: '╯',
  horizontal: '─',
  vertical: '│',
  teeE: '├',
  teeW: '┤',
  teeN: '┴',
  teeS: '┬',
  cross: '┼',
  pkMarker: '·',
};
