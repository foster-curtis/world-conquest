// Post-game stats (SPEC 8.3): charts over time, dice luck, biggest battle, longest-held continent.
import type { Color, SeatId } from '@wc/engine';
import { useMemo } from 'react';
import { COLOR_HEX } from '../board/colors.ts';
import { BackButton } from '../home/Brand.tsx';
import { buildFrames, type ReplayInput } from '../replay/frames.ts';
import { computeStats, type SeriesPoint, type Stats as StatsData } from './compute.ts';

function LineChart(props: {
  title: string;
  series: SeriesPoint[];
  pick: (p: SeriesPoint) => Record<SeatId, number>;
  seats: { seat: SeatId; name: string; color: Color }[];
}) {
  const W = 560;
  const H = 220;
  const pad = { l: 36, r: 12, t: 10, b: 24 };
  const xs = props.series.map((p) => p.turn);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs, xMin + 1);
  const yMax = Math.max(1, ...props.series.flatMap((p) => props.seats.map((s) => props.pick(p)[s.seat] ?? 0)));
  const x = (t: number) => pad.l + ((t - xMin) / (xMax - xMin)) * (W - pad.l - pad.r);
  const y = (v: number) => H - pad.b - (v / yMax) * (H - pad.t - pad.b);
  return (
    <figure className="chart">
      <figcaption>{props.title}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={props.title}>
        <title>{props.title}</title>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={pad.l} x2={W - pad.r} y1={y(yMax * f)} y2={y(yMax * f)} className="grid" />
            <text x={pad.l - 6} y={y(yMax * f)} textAnchor="end" dominantBaseline="central" className="axis">
              {Math.round(yMax * f)}
            </text>
          </g>
        ))}
        <text x={W / 2} y={H - 4} textAnchor="middle" className="axis">
          turn
        </text>
        {props.seats.map((s) => (
          <polyline
            key={s.seat}
            fill="none"
            stroke={COLOR_HEX[s.color]}
            strokeWidth={2.5}
            strokeLinejoin="round"
            points={props.series.map((p) => `${x(p.turn)},${y(props.pick(p)[s.seat] ?? 0)}`).join(' ')}
          />
        ))}
      </svg>
    </figure>
  );
}

export function StatsView({
  stats,
  territoryName,
  continentName,
}: {
  stats: StatsData;
  territoryName: (id: string) => string;
  continentName: (id: string) => string;
}) {
  const name = (seat: SeatId) => stats.seats.find((s) => s.seat === seat)?.name ?? 'Neutral';
  const maxLost = Math.max(1, ...stats.luck.flatMap((l) => [l.actualLost, l.expectedLost]));
  return (
    <div className="stats">
      <div className="legend">
        {stats.seats.map((s) => (
          <span key={s.seat}>
            <span className="dot" style={{ background: COLOR_HEX[s.color] }} /> {s.name}
          </span>
        ))}
      </div>
      <LineChart title="Territories over time" series={stats.series} pick={(p) => p.territories} seats={stats.seats} />
      <LineChart title="Armies over time" series={stats.series} pick={(p) => p.armies} seats={stats.seats} />
      <section>
        <h3>Dice luck</h3>
        <p className="hint">
          Armies lost (attacking and defending), actual against what the odds predict. Fewer than expected is lucky.
        </p>
        <table className="luck">
          <tbody>
            {stats.luck.map((l) => {
              const seat = stats.seats.find((s) => s.seat === l.seat);
              const diff = l.expectedLost - l.actualLost;
              return (
                <tr key={l.seat}>
                  <th scope="row">{name(l.seat)}</th>
                  <td>
                    <div className="bar exp" style={{ width: `${(l.expectedLost / maxLost) * 100}%` }}>
                      expected {l.expectedLost.toFixed(1)}
                    </div>
                    <div
                      className="bar act"
                      style={{
                        width: `${(l.actualLost / maxLost) * 100}%`,
                        background: seat ? COLOR_HEX[seat.color] : undefined,
                      }}
                    >
                      actual {l.actualLost}
                    </div>
                  </td>
                  <td className="verdict">
                    {Math.abs(diff) < 0.5
                      ? 'average'
                      : diff > 0
                        ? `${diff.toFixed(1)} luckier`
                        : `${(-diff).toFixed(1)} unluckier`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
      <section>
        <h3>Biggest battle</h3>
        {stats.biggestBattle ? (
          <p>
            {name(stats.biggestBattle.attacker)} attacked {territoryName(stats.biggestBattle.to)} (
            {name(stats.biggestBattle.defender)}) from {territoryName(stats.biggestBattle.from)}:{' '}
            {stats.biggestBattle.attackerLost + stats.biggestBattle.defenderLost} armies lost (
            {stats.biggestBattle.attackerLost} attacking, {stats.biggestBattle.defenderLost} defending) over{' '}
            {stats.biggestBattle.rounds} {stats.biggestBattle.rounds === 1 ? 'roll' : 'rolls'}.
          </p>
        ) : (
          <p>No battles were fought.</p>
        )}
      </section>
      <section>
        <h3>Longest-held continent</h3>
        {stats.longestContinent ? (
          <p>
            {name(stats.longestContinent.seat)} held {continentName(stats.longestContinent.continent)} for{' '}
            {stats.longestContinent.turns} {stats.longestContinent.turns === 1 ? 'turn' : 'turns'}.
          </p>
        ) : (
          <p>Nobody held a whole continent.</p>
        )}
      </section>
    </div>
  );
}

/** Stats screen for a finished game; feed it local events now, server events (ReplayResponse) in M5. */
export function StatsScreen(props: { input: ReplayInput; onClose: () => void; onReplay?: () => void }) {
  const frames = useMemo(() => buildFrames(props.input), [props.input]);
  const stats = useMemo(() => computeStats(frames), [frames]);
  return (
    <div className="screen statscreen">
      <header className="screen-head">
        <BackButton onClick={props.onClose} />
        <h1>Game stats</h1>
        {props.onReplay && (
          <button type="button" onClick={props.onReplay}>
            Replay
          </button>
        )}
      </header>
      <StatsView
        stats={stats}
        territoryName={(id) => frames.map.territories[id]?.name ?? id}
        continentName={(id) => frames.map.continents[id]?.name ?? id}
      />
    </div>
  );
}
