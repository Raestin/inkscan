// Run: node --test portal/advisor.test.cjs
// The advisor's live changes (edit_deck, set_owned, Undo) against a fake cloud and a fake Scryfall.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const UID = 'u-brian';
const sf = (id, name, type = 'Creature', extra = {}) => ({id, name, type_line: type, mana_cost: '{2}', cmc: 2, set: 'tst', set_name: 'Test', collector_number: id.slice(-3), rarity: 'common', prices: {usd: '0.10'}, legalities: {pauper: 'legal'}, color_identity: ['W'], oracle_text: '', ...extra});
const CARDS = [
  sf('00000000-0000-0000-0000-000000000001', 'Hovermyr', 'Artifact Creature — Myr'),
  sf('00000000-0000-0000-0000-000000000002', 'Hovermyr', 'Artifact Creature — Myr'),
  sf('00000000-0000-0000-0000-000000000003', 'War Screecher', 'Creature — Bird'),
  sf('00000000-0000-0000-0000-000000000004', 'Plains', 'Basic Land — Plains'),
  sf('00000000-0000-0000-0000-000000000005', 'Kor Skyfisher', 'Creature — Kor Soldier'),
];
const H1 = 'sf_' + CARDS[0].id, H2 = 'sf_' + CARDS[1].id, WS = 'sf_' + CARDS[2].id;

function world(){
  let clock = Date.parse('2026-11-15T12:00:00Z');
  const tick = () => new Date(clock += 1000).toISOString();
  const db = {
    collection: [
      {user_id: UID, game: 'mtg', card_id: H1, q: 4, f: 0, rainbow_foil: 0, updated_at: tick()},
      {user_id: UID, game: 'mtg', card_id: H2, q: 1, f: 1, rainbow_foil: 0, updated_at: tick()},
      {user_id: UID, game: 'mtg', card_id: WS, q: 2, f: 0, rainbow_foil: 0, updated_at: tick()},
    ],
    wishlist: [],
    decks: [{user_id: UID, game: 'mtg', id: 'dskies', name: 'Selesnya Skies', cards: {'hovermyr|': 4, 'plains|': 16}, commanders: [], meta: {format: 'pauper', built: true, fav: true}, deleted: false, updated_at: tick()}],
  };
  const writes = [];
  const parse = q => q.split('&').filter(Boolean).map(p => { const i = p.indexOf('='); return [p.slice(0, i), decodeURIComponent(p.slice(i + 1))]; });
  const matches = (row, filters) => filters.every(([k, v]) => {
    if (['select', 'order', 'limit', 'offset'].includes(k)) return true;
    if (v.startsWith('eq.')) return String(row[k]) === v.slice(3);
    if (v.startsWith('in.(')) return v.slice(4, -1).split(',').map(x => x.replace(/^"|"$/g, '')).includes(String(row[k]));
    throw Error('filter ' + k + v);
  });
  const res = (status, body) => ({ok: status < 300, status, json: async () => body});
  async function fetch(url, opts = {}){
    const u = new URL(url), method = opts.method || 'GET', body = opts.body ? JSON.parse(opts.body) : null;
    if (u.host === 'api.scryfall.com'){
      if (u.pathname === '/cards/collection') return res(200, {data: body.identifiers.map(x => CARDS.find(c => x.id ? c.id === x.id : c.name === x.name)).filter(Boolean)});
      if (u.pathname === '/cards/named'){ const c = CARDS.find(c => c.name.toLowerCase() === u.searchParams.get('fuzzy').toLowerCase()); return c ? res(200, c) : res(404, {}); }
      if (u.pathname === '/catalog/card-names') return res(200, {data: [...new Set(CARDS.map(c => c.name))]});
      return res(404, {});
    }
    const p = u.pathname.replace('/rest/v1/', '');
    if (p.startsWith('rpc/')) return res(200, null);
    const rows = db[p]; const filters = parse(u.search.slice(1));
    if (method === 'GET') return res(200, rows.filter(r => matches(r, filters)));
    if (method === 'PATCH'){
      const hit = rows.filter(r => matches(r, filters));
      for (const r of hit) Object.assign(r, body, {updated_at: tick()}); // the trigger stamps the server time
      writes.push({method, table: p, n: hit.length});
      return res(200, hit.map(r => ({...r})));
    }
    if (method === 'POST'){
      const key = p === 'decks' ? 'id' : 'card_id';
      if (rows.some(r => r[key] === body[key] && r.user_id === body.user_id)) return res(409, {code: '23505', message: 'duplicate'});
      const r = {...body, updated_at: tick()}; rows.push(r); writes.push({method, table: p, n: 1});
      return res(201, [{...r}]);
    }
    throw Error('unexpected ' + method + ' ' + url);
  }
  const store = new Map([['inkscan.session', JSON.stringify({access: 't', refresh: 'r', exp: Date.now() + 864e5, uid: UID, email: 'b@example.com'})]]);
  const toasts = [];
  const ctx = {
    fetch, console, setTimeout, clearTimeout, URL, structuredClone, TextDecoder, TextEncoder,
    location: {origin: 'https://raestin.github.io', pathname: '/inkscan/portal/'},
    localStorage: {getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k)},
  };
  ctx.self = ctx;
  vm.createContext(ctx);
  for (const f of ['../games.js', 'data.js', 'advisor.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), ctx, {filename: f});
  const D = ctx.PortalData, A = ctx.PortalAdvisor;
  const nvName = nv => { const c = D.state.cat?.rep(nv); return c ? c.n : nv.replace(/\|$/, ''); };
  const changed = [];
  A._ctx({game: 'mtg', gameDef: () => ({name: 'Magic'}), nvName, cardName: c => c.n, toast: m => toasts.push(m), onDeckChanged: d => changed.push(d?.id ?? null)});
  const cloudDeck = id => db.decks.find(d => d.id === id);
  const cloudCount = id => { const r = db.collection.find(r => r.card_id === id); return r ? r.q + r.f + r.rainbow_foil : 0; };
  const btn = () => ({disabled: false, textContent: ''});
  return {D, A, db, writes, toasts, changed, cloudDeck, cloudCount, btn, tick, load: () => D.load('mtg')};
}

test('edit_deck swaps a card in the cloud straight away, keeps the deck size, and records an Undo', async () => {
  const w = world(); await w.load();
  const out = await w.A._tools.edit_deck({deck_id: 'dskies', remove: [{name: 'Hovermyr', qty: 1}], add: [{name: 'War Screecher', qty: 1}]}, 'tu1');
  assert.equal(out.saved, true);
  assert.equal(out.cards, 20);
  assert.deepEqual(JSON.parse(JSON.stringify(w.cloudDeck('dskies').cards)), {'hovermyr|': 3, 'plains|': 16, 'warscreecher|': 1});
  assert.equal(w.cloudDeck('dskies').meta.built, true, 'built and favourite flags survive the edit');
  assert.equal(w.cloudDeck('dskies').meta.fav, true);
  assert.equal(out.added[0].name, 'War Screecher');
  assert.equal(out.added[0].free_copies, 2);
  const ch = w.A._chat().changes.tu1;
  assert.equal(ch.text, '−1 Hovermyr, +1 War Screecher');
  assert.deepEqual(w.changed, ['dskies']);
});

test('Undo puts the deck back exactly as it was', async () => {
  const w = world(); await w.load();
  await w.A._tools.edit_deck({deck_id: 'dskies', remove: [{name: 'Hovermyr', qty: 1}], add: [{name: 'War Screecher', qty: 1}]}, 'tu1');
  await w.A._undo('tu1', w.btn());
  assert.deepEqual(JSON.parse(JSON.stringify(w.cloudDeck('dskies').cards)), {'hovermyr|': 4, 'plains|': 16});
  assert.equal(w.A._chat().changes.tu1.undone, true);
  await w.A._undo('tu1', w.btn());
  assert.equal(w.writes.filter(x => x.table === 'decks').length, 2, 'a second Undo writes nothing');
});

test('edit_deck lands on the latest cloud version, not the copy loaded earlier', async () => {
  const w = world(); await w.load();
  const d = w.cloudDeck('dskies'); d.cards = {...d.cards, 'korskyfisher|': 2, 'plains|': 14}; d.updated_at = w.tick(); // the phone changed it
  await w.A._tools.edit_deck({deck_id: 'dskies', remove: [{name: 'Hovermyr', qty: 1}], add: [{name: 'War Screecher', qty: 1}]}, 'tu1');
  assert.deepEqual(JSON.parse(JSON.stringify(w.cloudDeck('dskies').cards)), {'hovermyr|': 3, 'plains|': 14, 'korskyfisher|': 2, 'warscreecher|': 1});
});

test('Undo refuses to overwrite a deck that changed after the edit', async () => {
  const w = world(); await w.load();
  await w.A._tools.edit_deck({deck_id: 'dskies', remove: [{name: 'Hovermyr', qty: 1}], add: [{name: 'War Screecher', qty: 1}]}, 'tu1');
  const d = w.cloudDeck('dskies'); d.cards = {...d.cards, 'korskyfisher|': 1}; d.updated_at = w.tick();
  await w.A._undo('tu1', w.btn());
  assert.equal(w.cloudDeck('dskies').cards['korskyfisher|'], 1);
  assert.equal(w.cloudDeck('dskies').cards['warscreecher|'], 1);
  assert.notEqual(w.A._chat().changes.tu1.undone, true);
  assert.match(w.toasts.at(-1), /changed since/);
});

test('edit_deck changes nothing when a card to remove is not in the deck', async () => {
  const w = world(); await w.load();
  const out = await w.A._tools.edit_deck({deck_id: 'dskies', remove: [{name: 'Kor Skyfisher', qty: 1}], add: [{name: 'War Screecher', qty: 1}]}, 'tu1');
  assert.match(out.error, /not in Selesnya Skies/);
  assert.equal(w.writes.length, 0);
  assert.equal(w.A._chat().changes?.tu1, undefined);
});

test('set_owned lowers the total across printings, most-held printing and normal copies first, and Undo restores it', async () => {
  const w = world(); await w.load();
  const out = await w.A._tools.set_owned({game: 'mtg', name: 'Hovermyr', owned: 3}, 'tu2');
  assert.equal(out.owned_before, 6);
  assert.equal(out.owned_now, 3);
  assert.equal(w.cloudCount(H1), 1);
  assert.equal(w.cloudCount(H2), 2, 'the second printing (1 normal, 1 foil) is untouched');
  assert.equal(out.built_decks_short_by, 1, 'Selesnya Skies is built with 4 and now one is missing');
  assert.equal(out.in_decks[0].deck, 'Selesnya Skies');
  await w.A._undo('tu2', w.btn());
  assert.equal(w.cloudCount(H1), 4);
  assert.equal(w.cloudCount(H2), 2);
  assert.match(w.toasts.at(-1), /back to 6/);
});

test('set_owned reads the latest cloud count first, so a phone change in between is not lost', async () => {
  const w = world(); await w.load();
  w.db.collection.find(r => r.card_id === WS).q = 5; // scanned on the phone after the portal loaded
  const out = await w.A._tools.set_owned({game: 'mtg', name: 'War Screecher', owned: 4}, 'tu3');
  assert.equal(out.owned_before, 5);
  assert.equal(w.cloudCount(WS), 4);
});

test('set_owned adds a first copy as a new row', async () => {
  const w = world(); await w.load();
  const out = await w.A._tools.set_owned({game: 'mtg', name: 'Kor Skyfisher', owned: 2}, 'tu4');
  assert.equal(out.owned_now, 2);
  assert.equal(w.cloudCount('sf_' + CARDS[4].id), 2);
  await w.A._undo('tu4', w.btn());
  assert.equal(w.cloudCount('sf_' + CARDS[4].id), 0);
});

test('a count write stops when the cloud no longer holds the count it was worked out from', async () => {
  const w = world(); await w.load();
  await assert.rejects(w.D.setCount(WS, {q: 1, f: 0, rf: 0}, {q: 9, f: 0, rf: 0}), /changed somewhere else/);
  assert.equal(w.cloudCount(WS), 2);
});

test('saving a deck from a stale copy is refused, because every write moves updated_at on', async () => {
  const w = world(); await w.load();
  const stale = structuredClone(w.D.state.decks.find(d => d.id === 'dskies'));
  await w.D.saveDeck({...stale, cards: {...stale.cards, 'plains|': 17}});
  await assert.rejects(w.D.saveDeck({...stale, cards: {...stale.cards, 'plains|': 15}}), /changed somewhere else/);
  assert.equal(w.cloudDeck('dskies').cards['plains|'], 17);
});

test('edit_deck leaves a deck alone while it has unsaved edits open in the workshop', async () => {
  const w = world(); await w.load();
  w.A._ctx({game: 'mtg', gameDef: () => ({name: 'Magic'}), nvName: nv => nv, cardName: c => c.n, toast: () => {}, editBlocked: id => id === 'dskies' ? 'The user has unsaved edits.' : null});
  const out = await w.A._tools.edit_deck({deck_id: 'dskies', remove: [{name: 'Hovermyr', qty: 1}], add: [{name: 'War Screecher', qty: 1}]}, 'tu9');
  assert.match(out.error, /unsaved edits/);
  assert.equal(w.writes.length, 0);
});
