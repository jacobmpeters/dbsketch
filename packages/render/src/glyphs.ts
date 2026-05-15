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
};

export const UNICODE: Glyphs = {
  cornerTL: '┌',
  cornerTR: '┐',
  cornerBL: '└',
  cornerBR: '┘',
  horizontal: '─',
  vertical: '│',
  teeE: '├',
  teeW: '┤',
  teeN: '┴',
  teeS: '┬',
  cross: '┼',
};
