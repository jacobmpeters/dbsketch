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

export type PinRelation = 'right-of' | 'left-of' | 'above' | 'below';

export interface PinHint {
  entity: string;
  relation: PinRelation;
  target: string;
}

export interface LayoutHints {
  clusters: ClusterHint[];
  ranks: RankHint[];
  pins: PinHint[];
}

export interface IR {
  entities: Entity[];
  refs: Ref[];
  hints: LayoutHints;
}
