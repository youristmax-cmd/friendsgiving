// Friendsgiving potluck API: one Durable Object holds the whole sign-up.
// A Durable Object handles one request at a time, so claims can't race.
//
//   GET  ?action=menu&me=<claimId>     claimed dishes, by course
//   GET  ?action=open&name=<typed>     items with an open slot
//   GET  ?action=identify&name=<typed> who that is, and their current dish
//   POST {action:"claim", name, item, description, swap}
//   GET  ?action=admin&key=<ADMIN_KEY>            everything, plus the log
//   POST {action:"admin", key, op:"view"}         the admin page: slots, households, log
//   POST {action:"admin", key, op:"roster", added, solo, rsvp}   guest list changes from Partiful
//   POST {action:"admin", key, op, ...}           host edits (see core.adminEdit)
import { DurableObject } from 'cloudflare:workers';
import * as core from './core.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400'
};

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS }
});

export class Potluck extends DurableObject {
  async state() {
    if (!this.cached) this.cached = (await this.ctx.storage.get('state')) || { slots: core.seedSlots() };
    return this.cached;
  }

  // The fixed list plus the changes synced from Partiful (see core.mergeRoster).
  people() {
    let base = [];
    try { base = JSON.parse(this.env.GUESTS || '{}').guests || []; } catch { /* no list */ }
    return core.mergeRoster(base, this.cached && this.cached.roster);
  }

  async save(log) {
    const puts = { state: this.cached };
    log.forEach((entry, i) => { puts['log:' + String(entry.at).padStart(15, '0') + ':' + i + ':' + crypto.randomUUID().slice(0, 8)] = entry; });
    await this.ctx.storage.put(puts);
  }

  isAdmin(key) {
    const want = this.env.ADMIN_KEY || '';
    if (!want || typeof key !== 'string' || key.length !== want.length) return false;
    let diff = 0;
    for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ key.charCodeAt(i);
    return diff === 0;
  }

  async fetch(request) {
    try {
      const url = new URL(request.url);
      const state = await this.state();
      if (request.method === 'GET') {
        const p = url.searchParams;
        const action = p.get('action');
        if (action === 'menu') return json(core.menu(state, p.get('me')));
        if (action === 'open') return json(core.openItems(state, p.get('name'), this.people()));
        if (action === 'identify') return json(core.identifyView(state, p.get('name'), this.people()));
        if (action === 'admin') {
          if (!this.isAdmin(p.get('key'))) return json({ error: 'forbidden' }, 403);
          const log = [...(await this.ctx.storage.list({ prefix: 'log:' })).values()];
          return json({ slots: state.slots, guests: this.people().length, log });
        }
        return json({ error: 'bad_action', message: 'Unknown action.' }, 400);
      }
      if (request.method === 'POST') {
        let body;
        try { body = JSON.parse(await request.text()); } catch { return json({ error: 'bad_request', message: 'Body must be JSON.' }, 400); }
        if (body.action === 'claim') {
          const { result, log } = core.claim(state, body, this.people(), { newId: () => crypto.randomUUID().replace(/-/g, '').slice(0, 16) });
          if (log.length) await this.save(log);
          return json(result);
        }
        if (body.action === 'admin') {
          if (!this.isAdmin(body.key)) return json({ error: 'forbidden' }, 403);
          if (body.op === 'view') {
            const log = [...(await this.ctx.storage.list({ prefix: 'log:', reverse: true, limit: 200 })).values()];
            return json({ ...core.adminView(state, this.people()), log });
          }
          if (body.op === 'roster') {
            state.roster = core.cleanRoster(body);
            await this.save([{ at: Date.now(), action: 'roster', item: '', added: state.roster.added.length, solo: state.roster.solo.length, rsvp: Object.keys(state.roster.rsvp).length }]);
            return json({ ok: true, roster: state.roster, guests: this.people().length });
          }
          const r = core.adminEdit(state, body);
          await this.save([{ at: Date.now(), action: r.action, slotId: r.slot.id, item: r.slot.item, name: r.slot.name, desc: r.slot.desc }]);
          return json({ ok: true, slot: r.slot });
        }
        return json({ error: 'bad_action', message: 'Unknown action.' }, 400);
      }
      return json({ error: 'bad_method' }, 405);
    } catch (err) {
      if (err instanceof core.UserError) return json({ error: err.code, message: err.message });
      // Anything unexpected: drop the in-memory copy so the next request reloads from storage.
      this.cached = null;
      console.error(err && err.stack || err);
      return json({ error: 'server', message: 'Something went wrong on our end.' }, 500);
    }
  }
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const stub = env.POTLUCK.get(env.POTLUCK.idFromName('friendsgiving'));
    return stub.fetch(request);
  }
};
