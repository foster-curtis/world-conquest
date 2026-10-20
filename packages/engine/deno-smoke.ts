// CI: `deno run packages/engine/deno-smoke.ts`. Fails if the engine pulls in anything Node-only.
import * as engine from './src/index.ts';

if (engine.tradeValue(0) !== 4) throw new Error('engine loaded but tradeValue is wrong');
console.log(`engine OK in Deno (${Object.keys(engine).length} runtime exports)`);
