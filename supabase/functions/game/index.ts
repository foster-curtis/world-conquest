// Single edge function for every command and PlayerView read; the cron fallback
// calls it with the `system` actor (SPEC §6). Not implemented yet.
import '@supabase/functions-js/edge-runtime.d.ts';
import { TIMERS } from '@wc/engine';

Deno.serve(() => Response.json({ error: 'not implemented', graceMs: TIMERS.graceMs }, { status: 501 }));
