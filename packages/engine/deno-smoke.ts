// CI: `deno run packages/engine/deno-smoke.ts`. Fails if the engine pulls in anything Node-only,
// then plays a short decide/apply sequence on the classic map.
import * as engine from './src/index.ts';

const { apply, classicMap, createInitialState, decide, defaultSettings, getMap, replay, toPlayerView } = engine;

if (engine.tradeValue(0) !== 4) throw new Error('engine loaded but tradeValue is wrong');
if (engine.validateMap(classicMap).length > 0) throw new Error('classic map is invalid');

let seed = 42;
const rng = () => {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};
const map = getMap('classic');
if (!map) throw new Error('classic map not registered');
const initial = createInitialState('deno-smoke', defaultSettings('local'));
let state = initial;
const log: engine.GameEvent[] = [];

function run(actor: engine.Actor, cmd: engine.Command): void {
  const r = decide(state, actor, cmd, { now: new Date('2026-01-01T00:00:00Z'), rng, map: map as engine.MapDefinition });
  if (!r.ok) throw new Error(`${cmd.type} rejected: ${r.error.code}`);
  for (const e of r.value) {
    state = apply(state, e);
    log.push(e);
  }
}

const system: engine.Actor = { kind: 'system' };
run(system, { type: 'JoinGame', displayName: 'Ada' });
run(system, { type: 'JoinGame', displayName: 'Bo' });
run({ kind: 'seat', seat: 0 }, { type: 'StartGame' });
for (const seat of [0, 1]) {
  if (state.phase.kind !== 'setup') throw new Error('expected setup');
  const first = Object.keys(state.territories).find((t) => state.territories[t].owner === seat) as string;
  run({ kind: 'seat', seat }, { type: 'SubmitSetup', placements: { [first]: state.phase.armiesToPlace[seat] } });
}
if (state.phase.kind !== 'turn') throw new Error('expected turn 1');
const me = state.phase.seat;
const mine = Object.keys(state.territories).find((t) => state.territories[t].owner === me) as string;
run(
  { kind: 'seat', seat: me },
  { type: 'PlaceReinforcements', placements: { [mine]: state.phase.reinforcementsRemaining } },
);
run({ kind: 'seat', seat: me }, { type: 'EndTurn' });

if (JSON.stringify(replay(initial, log)) !== JSON.stringify(state)) throw new Error('replay mismatch');
if (toPlayerView(state, 0).seats.some((s) => s.seat !== 0 && s.hand !== null)) throw new Error('view leaks hands');
console.log(
  `engine OK in Deno (${Object.keys(engine).length} runtime exports, ${log.length} events, phase ${state.phase.kind})`,
);
