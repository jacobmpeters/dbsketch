import type { IR } from '@ascii-erd/parser';

export interface Placement {
  entity: string;
  colStrip: number;
  rowStrip: number;
}

// Sizes are in character cells. Channel arrays have length (strip count - 1):
// channels live between adjacent node strips. Outer channels are deferred.
export interface StripSizing {
  colStripWidths: number[];
  channelColWidths: number[];
  rowStripHeights: number[];
  channelRowHeights: number[];
}

export interface Layout {
  ir: IR;
  placements: Placement[];
  sizing: StripSizing;
}
