// M5: two players sign in with the 6-digit code from the mail viewer, create, join by code, start and play a turn,
// all through the web app's own client code (online/api.ts and online/auth/auth.ts).
import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { createApi, type GameApi } from '../../../apps/web/src/online/api.ts';
import { requestSignIn, saveDisplayName, verifyCode } from '../../../apps/web/src/online/auth/auth.ts';
import { ANON_KEY, API_URL, FN_URL, MAIL_URL, owned, uniqueEmail, waitFor } from './helpers.ts';

async function codeFromMail(email: string): Promise<string> {
  const mail = await waitFor(async () => {
    const res = await fetch(`${MAIL_URL}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`);
    if (!res.ok) return null;
    const body = (await res.json()) as { messages: { ID: string }[] };
    if (!body.messages[0]) return null;
    const msg = await fetch(`${MAIL_URL}/api/v1/message/${body.messages[0].ID}`);
    return (await msg.json()) as { Text: string };
  });
  const code = /\b(\d{6})\b/.exec(mail.Text)?.[1];
  if (!code) throw new Error('no code in the email');
  return code;
}

async function signIn(name: string): Promise<{ api: GameApi; userId: string }> {
  const client = createClient(API_URL, ANON_KEY, { auth: { persistSession: false, flowType: 'pkce' } });
  const email = uniqueEmail(name.toLowerCase());
  await requestSignIn(client, email, 'http://localhost:5173/g/K7QM2X');
  await verifyCode(client, email, await codeFromMail(email));
  const { data } = await client.auth.getSession();
  const session = data.session;
  if (!session) throw new Error('no session after verifying the code');
  await saveDisplayName(client, session.user.id, name);
  const api = createApi({ baseUrl: FN_URL, apiKey: ANON_KEY, getToken: () => session.access_token });
  return { api, userId: session.user.id };
}

describe('online client: sign in, create, join, start, play a turn', () => {
  it('works end to end through online/api.ts', async () => {
    const host = await signIn('Hana');
    const guest = await signIn('Gus');

    const created = await host.api.createGame({ settings: { winCondition: 'classic', pace: 'async' } });
    expect(created.joinCode).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/);

    // The guest finds the game by its code: not a member yet.
    const found = await guest.api.lookup(created.joinCode);
    expect(found).toMatchObject({
      gameId: created.gameId,
      phase: 'lobby',
      isMember: false,
      players: 1,
      hostName: 'Hana',
    });

    await guest.api.command(created.gameId, { type: 'JoinGame', displayName: '' });
    expect((await guest.api.lookup(created.joinCode)).isMember).toBe(true);

    // Lobby view: names come from the profiles, not the client.
    const lobby = await host.api.view(created.gameId);
    expect(lobby.events).toBeNull(); // no `since`: snap
    expect(lobby.view.seats.filter((s) => s.kind === 'human').map((s) => s.displayName)).toEqual(['Hana', 'Gus']);

    const started = await host.api.command(created.gameId, { type: 'StartGame' }, lobby.view.version);
    expect(started.version).toBeGreaterThan(lobby.view.version);

    // Both submit their hidden setup.
    for (const p of [host, guest]) {
      const { view } = await p.api.view(created.gameId);
      expect(view.phase.kind).toBe('setup');
      const seat = view.viewer as number;
      if (view.phase.kind !== 'setup') throw new Error('unreachable');
      const [first] = owned(view, seat);
      await p.api.command(created.gameId, {
        type: 'SubmitSetup',
        placements: { [first]: view.phase.armiesToPlace[seat] },
      });
    }

    // Whoever is up plays a turn: reinforce, end turn. The other sees it with ?since=.
    const players = [host, guest];
    const views = await Promise.all(players.map((p) => p.api.view(created.gameId)));
    const idx = views.findIndex((v) => v.view.phase.kind === 'turn' && v.view.phase.seat === v.view.viewer);
    expect(idx).toBeGreaterThanOrEqual(0);
    const me = players[idx];
    const other = players[1 - idx];
    const before = views[1 - idx].view.version;
    const mine = views[idx].view;
    if (mine.phase.kind !== 'turn') throw new Error('unreachable');
    const [first] = owned(mine, mine.viewer as number);
    await me.api.command(created.gameId, {
      type: 'PlaceReinforcements',
      placements: { [first]: mine.phase.reinforcementsRemaining },
    });
    const ended = await me.api.command(created.gameId, { type: 'EndTurn' });

    const caught = await other.api.view(created.gameId, before);
    expect(caught.view.version).toBe(ended.version);
    expect(caught.events?.map((e) => e.event.type)).toContain('TurnEnded');
    expect(caught.view.phase.kind === 'turn' && caught.view.phase.seat).toBe(caught.view.viewer);
  });

  it('answers a stale expectedVersion with STALE_VERSION and an old protocol with 426', async () => {
    const host = await signIn('Stella');
    const created = await host.api.createGame();
    await expect(
      host.api.command(created.gameId, { type: 'ChangeColor', color: 'green' }, created.version - 1),
    ).rejects.toMatchObject({ code: 'STALE_VERSION', status: 409 });

    let outdated = false;
    const old = createApi({
      baseUrl: FN_URL,
      apiKey: ANON_KEY,
      getToken: () => null,
      onOutdated: () => {
        outdated = true;
      },
      fetch: ((url: string, init: RequestInit) => {
        const headers = { ...(init.headers as Record<string, string>), 'x-wc-protocol': '0' };
        return fetch(url, { ...init, headers });
      }) as typeof fetch,
    });
    await expect(old.lookup('K7QM2X')).rejects.toMatchObject({ status: 426 });
    expect(outdated).toBe(true);
  });
});
