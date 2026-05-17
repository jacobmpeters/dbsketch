export interface Column {
  name: string;
  type: string;
  pk: boolean;
}

export interface Entity {
  name: string;
  columns: Column[];
}

export type Cardinality = 'one-to-many' | 'one-to-one' | 'many-to-many';

export interface RefEndpoint {
  entity: string;
  column: string;
}

export interface Ref {
  parent: RefEndpoint;
  child: RefEndpoint;
  cardinality: Cardinality;
}

export interface ClusterHint {
  name: string;
  entities: string[];
}

export interface RankHint {
  rank: number;
  entities: string[];
}

export interface PinHint {
  entity: string;
  // Either or both can be specified. null means "let the algorithm decide
  // for this axis." Both null is rejected by the parser.
  col: number | null;
  row: number | null;
}

// Mark an entity as a layout hub: rank assignment puts it in a center col
// with related entities fanning out on both sides. Optional left/right lists
// bias which side specific neighbors land on.
//
// source distinguishes user-provided hints (from @center in @layout block)
// from synthetic ones emitted by hub auto-detection. User hints always win.
export interface CenterHint {
  entity: string;
  left: string[];
  right: string[];
  source: 'user' | 'auto';
}

// Opt-out from automatic column reordering inside entities. `global: true`
// freezes every entity's columns at declared order; otherwise `entities`
// names the specific entities to leave alone.
export interface PreserveOrderHint {
  global: boolean;
  entities: string[];
}

export interface LayoutHints {
  clusters: ClusterHint[];
  ranks: RankHint[];
  pins: PinHint[];
  centers: CenterHint[];
  preserveOrder: PreserveOrderHint;
}

export interface IR {
  entities: Entity[];
  refs: Ref[];
  hints: LayoutHints;
}
