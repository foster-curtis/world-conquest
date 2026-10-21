// SVG board (SPEC 5.3, 5.4, 7.2, 7.3): territory shapes, sea links, army badges, zoom/pan.
// Pure view: it is given display data and reports SelActions. Shapes and badges are memoized so that
// panning and zooming (a camera transform) never re-render them.
import type { Color, TerritoryId } from '@wc/engine';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { isTap, pointerContextMenu, pointerHover, pointerTap } from '../input/pointer.ts';
import type { SelAction } from '../input/selection.ts';
import { type Camera, clampCamera, fitCamera, fitScale, MAX_ZOOM, pan, panToKeep, zoomAt } from './camera.ts';
import { COLOR_HEX, COLOR_INK } from './colors.ts';
import { geometry, type Pt, WORLD } from './geometry.ts';

export interface TerritoryDisplay {
  color: Color | null; // null = unclaimed
  initial: string;
  armies: number | null;
  /** Armies staged but not confirmed yet. */
  staged: number;
  capital: boolean;
  label: string;
}

export type Fx =
  | { key: string; kind: 'loss'; territory: TerritoryId; text: string }
  | { key: string; kind: 'move'; from: TerritoryId; to: TerritoryId };

export interface BoardProps {
  display: (id: TerritoryId) => TerritoryDisplay;
  /** Changes whenever `display` would return something different (keeps memoization honest). */
  displayVersion: string | number;
  source: TerritoryId | null;
  target: TerritoryId | null;
  focus: TerritoryId | null;
  candidates: readonly TerritoryId[];
  targets: readonly TerritoryId[];
  fx: Fx[];
  interactive: boolean;
  onAction: (a: SelAction) => void;
  /** Tooltip text for hover (desktop mouse). */
  tooltip: (id: TerritoryId) => string;
  boardRef?: React.RefObject<HTMLDivElement | null>;
  onFocusChange?: (focused: boolean) => void;
}

type Mark = 'none' | 'candidate' | 'target' | 'source' | 'dim';

const Shape = memo(function Shape({ id, d, fill, mark }: { id: string; d: string; fill: string; mark: Mark }) {
  return <path data-t={id} className={`shape ${mark}`} d={d} fill={fill} />;
});

const Badge = memo(function Badge(props: {
  id: string;
  x: number;
  y: number;
  display: TerritoryDisplay;
  mark: Mark;
  focused: boolean;
}) {
  const { id, x, y, display: t, mark, focused } = props;
  const fill = t.color ? COLOR_HEX[t.color] : '#e8edf2';
  const ink = t.color ? COLOR_INK[t.color] : '#1c1c1c';
  const shown = t.armies === null ? '' : String(t.armies + t.staged);
  return (
    // biome-ignore lint/a11y/useSemanticElements: an SVG group cannot be a <button>
    <g
      id={`badge-${id}`}
      data-t={id}
      role="button"
      aria-label={t.label}
      className={`badge ${mark}${focused ? ' focused' : ''}`}
      style={{ transform: `translate(${x}px, ${y}px) scale(var(--inv))` }}
    >
      {/* 44 px touch target (SPEC 7.2) */}
      <circle className="hit" r={22} />
      <circle className="ring" r={19} />
      <circle className="disc" r={15} fill="#fff" stroke={fill} strokeWidth={3} />
      <text className="count" textAnchor="middle" dominantBaseline="central" y={1}>
        {shown}
      </text>
      {t.color && (
        <g transform="translate(-13 -13)">
          <circle r={8} fill={fill} stroke="#fff" strokeWidth={1.5} />
          <text className="initial" textAnchor="middle" dominantBaseline="central" fill={ink}>
            {t.initial}
          </text>
        </g>
      )}
      {t.staged > 0 && (
        <g transform="translate(14 -13)">
          <rect x={-11} y={-8} width={22} height={16} rx={8} fill="#1f2937" />
          <text className="staged" textAnchor="middle" dominantBaseline="central">
            +{t.staged}
          </text>
        </g>
      )}
      {t.capital && (
        <text className="capital" textAnchor="middle" y={-22}>
          ★
        </text>
      )}
    </g>
  );
});

function linkPath(from: Pt, to: Pt, via?: Pt): string {
  return via
    ? `M${from[0]} ${from[1]}Q${via[0]} ${via[1]} ${to[0]} ${to[1]}`
    : `M${from[0]} ${from[1]}L${to[0]} ${to[1]}`;
}

const Links = memo(function Links({ lit }: { lit: ReadonlySet<TerritoryId> }) {
  return (
    <g className="links" pointerEvents="none">
      {geometry.seaLinks.map((l) => (
        <path
          key={`${l.a}-${l.b}`}
          className={`sea${lit.has(l.a) && lit.has(l.b) ? ' lit' : ''}`}
          d={linkPath(l.from, l.to, l.via)}
        />
      ))}
      {geometry.wrapLinks.map((w) => {
        const on = lit.has(w.a) || lit.has(w.b);
        return w.stubs.map((s) => {
          const dir = s.to[0] < s.from[0] ? -1 : 1;
          const [x, y] = s.to;
          return (
            <g key={`${w.a}-${w.b}-${s.territory}`} className={`sea wrap${on ? ' lit' : ''}`}>
              <path d={linkPath(s.from, s.to)} />
              <path className="chevron" d={`M${x - dir * 9} ${y - 7}L${x} ${y}L${x - dir * 9} ${y + 7}`} />
            </g>
          );
        });
      })}
    </g>
  );
});

function idOf(target: EventTarget | null): TerritoryId | null {
  const el = target instanceof Element ? target.closest('[data-t]') : null;
  return el ? el.getAttribute('data-t') : null;
}

export function Board(props: BoardProps) {
  const { display, displayVersion, source, target, focus, candidates, targets, fx, interactive, onAction } = props;
  const box = useRef<HTMLDivElement | null>(null);
  const holder = props.boardRef ?? box;
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [cam, setCam] = useState<Camera>(() => fitCamera({ w: 800, h: 600 }, WORLD));
  const camRef = useRef(cam);
  camRef.current = cam;
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const [hover, setHover] = useState<{ id: TerritoryId; x: number; y: number } | null>(null);

  // Track the container size; keep the camera fitted until the user has zoomed.
  const userZoomed = useRef(false);
  useLayoutEffect(() => {
    const el = holder.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const next = { w: Math.max(1, r.width), h: Math.max(1, r.height) };
      setSize(next);
      setCam((c) => (userZoomed.current ? clampCamera(c, next, WORLD) : fitCamera(next, WORLD)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [holder]);

  const update = useCallback((fn: (c: Camera, s: { w: number; h: number }) => Camera) => {
    userZoomed.current = true;
    setCam((c) => fn(c, sizeRef.current));
  }, []);

  // Wheel / trackpad zoom needs a non-passive listener.
  useEffect(() => {
    const el = holder.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const f = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015));
      update((c, s) => zoomAt(c, e.clientX - r.left, e.clientY - r.top, f, s, WORLD));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [holder, update]);

  // Keep the focused territory on screen when zoomed in (SPEC 7.2).
  useEffect(() => {
    if (!focus) return;
    const a = geometry.anchors[focus];
    if (!a) return;
    const c = camRef.current;
    const min = fitScale(sizeRef.current, WORLD);
    if (c.s <= min * 1.01) return;
    update((cc, s) => panToKeep(cc, a[0], a[1], s, WORLD));
  }, [focus, update]);

  // Pointer gestures: tap, drag-pan, pinch-zoom.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{
    downId: TerritoryId | null;
    down: { x: number; y: number };
    last: { x: number; y: number };
    moved: boolean;
    pinch: { dist: number; mid: { x: number; y: number }; cam: Camera } | null;
  } | null>(null);

  const local = (e: React.PointerEvent) => {
    const r = (holder.current as HTMLDivElement).getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    if (pointers.current.size === 1) {
      gesture.current = { downId: idOf(e.target), down: p, last: p, moved: false, pinch: null };
    } else if (pointers.current.size === 2 && gesture.current) {
      const [a, b] = [...pointers.current.values()];
      gesture.current.moved = true;
      gesture.current.pinch = {
        dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        cam: camRef.current,
      };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = local(e);
    const g = gesture.current;
    if (!pointers.current.has(e.pointerId)) {
      if (e.pointerType === 'mouse' && interactive) {
        const id = idOf(e.target);
        onAction(pointerHover(id));
        setHover(id ? { id, x: p.x, y: p.y } : null);
      }
      return;
    }
    pointers.current.set(e.pointerId, p);
    if (!g) return;
    if (g.pinch && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const pinch = g.pinch;
      update((_, s) => {
        const z = zoomAt(pinch.cam, pinch.mid.x, pinch.mid.y, dist / pinch.dist, s, WORLD);
        return pan(z, mid.x - pinch.mid.x, mid.y - pinch.mid.y, s, WORLD);
      });
      return;
    }
    if (!g.moved && isTap(g.down, p)) return;
    if (!g.moved) {
      g.moved = true;
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    }
    const dx = p.x - g.last.x;
    const dy = p.y - g.last.y;
    g.last = p;
    setHover(null);
    update((c, s) => pan(c, dx, dy, s, WORLD));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const g = gesture.current;
    const had = pointers.current.delete(e.pointerId);
    if (!had || !g) return;
    if (pointers.current.size === 0) {
      gesture.current = null;
      if (!g.moved && interactive) onAction(pointerTap(g.downId));
    } else if (pointers.current.size === 1) {
      g.pinch = null;
      g.last = [...pointers.current.values()][0];
    }
  };

  const onPointerCancel = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) gesture.current = null;
  };

  // Marks per territory.
  const candidateSet = useMemo(() => new Set(candidates), [candidates]);
  const targetSet = useMemo(() => new Set(targets), [targets]);
  const markOf = (id: TerritoryId): Mark => {
    if (id === source) return 'source';
    if (id === target) return 'source';
    if (source) return targetSet.has(id) ? 'target' : 'dim';
    return candidateSet.has(id) ? 'candidate' : 'none';
  };
  const lit = useMemo(() => {
    const s = new Set<TerritoryId>();
    for (const id of [source, target, focus]) if (id) s.add(id);
    if (source) for (const t of targets) s.add(t);
    return s;
  }, [source, target, focus, targets]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: displayVersion is the declared change signal for `display`
  const shapes = useMemo(
    () =>
      geometry.paths.map((p) => {
        const t = display(p.id);
        return (
          <Shape key={p.id} id={p.id} d={p.d} fill={t.color ? COLOR_HEX[t.color] : '#dfe5ea'} mark={markOf(p.id)} />
        );
      }),
    // eslint-disable-next-line
    [displayVersion, source, target, candidateSet, targetSet],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: displayVersion is the declared change signal for `display`
  const badges = useMemo(
    () =>
      geometry.paths.map((p) => {
        const a = geometry.anchors[p.id];
        if (!a) return null;
        return (
          <Badge
            key={p.id}
            id={p.id}
            x={a[0]}
            y={a[1]}
            display={display(p.id)}
            mark={markOf(p.id)}
            focused={focus === p.id}
          />
        );
      }),
    [displayVersion, source, target, candidateSet, targetSet, focus],
  );

  const zoomBy = (f: number) => update((c, s) => zoomAt(c, s.w / 2, s.h / 2, f, s, WORLD));
  const reset = () => {
    userZoomed.current = false;
    setCam(fitCamera(sizeRef.current, WORLD));
  };

  const inv = 1 / cam.s;
  return (
    <div
      className="board"
      ref={holder}
      role="application"
      aria-label="World map"
      aria-activedescendant={focus ? `badge-${focus}` : undefined}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the board is the single keyboard focus area (SPEC 7.4)
      tabIndex={0}
      onFocus={() => props.onFocusChange?.(true)}
      onBlur={() => props.onFocusChange?.(false)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onPointerLeave={() => {
        setHover(null);
        if (interactive) onAction(pointerHover(null));
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        if (interactive) onAction(pointerContextMenu());
      }}
    >
      <svg width={size.w} height={size.h} style={{ ['--inv' as string]: inv }} aria-hidden="false">
        <title>World map</title>
        <g transform={`translate(${cam.tx} ${cam.ty}) scale(${cam.s})`}>
          <rect className="ocean" x={-2000} y={-2000} width={geometry.width + 4000} height={geometry.height + 4000} />
          {shapes}
          <Links lit={lit} />
          <g className="fx" pointerEvents="none">
            {fx.map((f) => {
              if (f.kind === 'move') {
                const a = geometry.anchors[f.from];
                const b = geometry.anchors[f.to];
                if (!a || !b) return null;
                return <line key={f.key} className="fx-move" x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} />;
              }
              const a = geometry.anchors[f.territory];
              if (!a) return null;
              return (
                <g key={f.key} style={{ transform: `translate(${a[0]}px, ${a[1]}px) scale(var(--inv))` }}>
                  <text className="fx-loss" textAnchor="middle">
                    {f.text}
                  </text>
                </g>
              );
            })}
          </g>
          <g className="badges">{badges}</g>
        </g>
      </svg>
      <div className="zoom-buttons">
        <button
          type="button"
          aria-label="Zoom in"
          onClick={() => zoomBy(1.4)}
          disabled={cam.s >= fitScale(size, WORLD) * MAX_ZOOM}
        >
          +
        </button>
        <button type="button" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.4)}>
          −
        </button>
        <button type="button" aria-label="Reset view" onClick={reset}>
          ⤢
        </button>
      </div>
      {hover && interactive && (
        <div className="tooltip" style={{ left: hover.x + 14, top: hover.y + 14 }}>
          {props.tooltip(hover.id)}
        </div>
      )}
    </div>
  );
}
