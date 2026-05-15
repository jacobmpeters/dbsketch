import type { IR } from '@ascii-erd/parser';
import { place } from './place.js';
import { rank } from './rank.js';
import { size } from './size.js';
import type { Layout } from './types.js';

export function layout(ir: IR): Layout {
  const ranks = rank(ir);
  const placements = place(ir, ranks);
  const sizing = size(ir, placements);
  return { ir, placements, sizing };
}
