// Board art: territory outlines from board.svg, anchors and sea links from layout.json (M2 output).
import type { TerritoryId } from '@wc/engine';
import svgSource from './board.svg?raw';
import layout from './layout.json';

export type Pt = [number, number];

export interface SeaLink {
  a: TerritoryId;
  b: TerritoryId;
  from: Pt;
  to: Pt;
  /** Quadratic Bezier control point (optional). */
  via?: Pt;
}

export interface WrapStub {
  territory: TerritoryId;
  from: Pt;
  to: Pt;
}

export interface WrapLink {
  a: TerritoryId;
  b: TerritoryId;
  stubs: WrapStub[];
}

export interface BoardGeometry {
  width: number;
  height: number;
  /** Draw order = document order in board.svg. */
  paths: { id: TerritoryId; d: string }[];
  anchors: Record<TerritoryId, Pt>;
  seaLinks: SeaLink[];
  wrapLinks: WrapLink[];
}

export function parsePaths(svg: string): { id: TerritoryId; d: string }[] {
  const out: { id: TerritoryId; d: string }[] = [];
  for (const m of svg.matchAll(/<path id="([a-z0-9_]+)" d="([^"]+)"/g)) out.push({ id: m[1], d: m[2] });
  return out;
}

export const geometry: BoardGeometry = {
  width: layout.width,
  height: layout.height,
  paths: parsePaths(svgSource),
  anchors: layout.anchors as unknown as Record<TerritoryId, Pt>,
  seaLinks: layout.seaLinks as unknown as SeaLink[],
  wrapLinks: layout.wrapLinks as unknown as WrapLink[],
};

/** The board's size in the Size shape camera.ts expects. */
export const WORLD = { w: geometry.width, h: geometry.height };
