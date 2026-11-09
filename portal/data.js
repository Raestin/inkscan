/* InkScan Portal data layer: sign-in, reading the collection, wishlist and decks from the cloud,
   resolving every card to full card data, ownership math, and saving decks back.
   The phone app stays the owner of the collection; the portal reads it and only ever writes deck rows,
   which the phone picks up on its next Update. */
(function(root){
  'use strict';
  const SB_URL = 'https://fzavmefambwdhnzmbvxv.supabase.co';
  const SB_KEY = 'sb_publishable_biFosNnFXZK8xSUiJOk0xw_wLrKGrD6';
  const SCRYFALL = 'https://api.scryfall.com';
  const G = root.InkGames, norm = G.norm;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch(e){ return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch(e){ return false; } };

  /* ---------- auth (same session key as the phone app, so one sign-in covers both on one browser) ---------- */
  let session = lsGet('inkscan.session', null), household = null;
  const headers = tok => { const h = {apikey: SB_KEY, 'Content-Type': 'application/json'}; if (tok) h.Authorization = 'Bearer ' + tok; return h; };
  function cloudAllowed(){
    return location.origin === 'https://raestin.github.io' && location.pathname.startsWith('/inkscan/');
  }
  async function authCall(path, body){
    if (!cloudAllowed()) throw Error('Cloud access is off in this local preview.');
    const r = await fetch(`${SB_URL}/auth/v1/${path}`, {method: 'POST', headers: headers(), body: JSON.stringify(body)});
    const j = await r.json().catch(() => ({}));
    if (!r.ok){ const e = Error(j.msg || j.error_description || j.message || `Sign-in failed (${r.status})`); e.status = r.status; throw e; }
    return j;
  }
  function keep(j){
    session = {access: j.access_token, refresh: j.refresh_token, exp: Date.now() + (j.expires_in || 3600) * 1000, uid: j.user?.id || session?.uid, email: j.user?.email || session?.email};
    lsSet('inkscan.session', session);
  }
  async function token(){
    if (!session) return null;
    if (Date.now() > session.exp - 60000){
      try { keep(await authCall('token?grant_type=refresh_token', {refresh_token: session.refresh})); }
      catch(e){ if (e.status === 400 || e.status === 401){ session = null; lsSet('inkscan.session', null); } throw e; }
    }
    return session.access;
  }
  async function rest(method, path, body, extra){
    const t = await token(); if (!t){ const e = Error('Not signed in'); e.status = 401; throw e; }
    const r = await fetch(`${SB_URL}/rest/v1/${path}`, {method, headers: {...headers(t), ...(extra || {})}, body: body ? JSON.stringify(body) : undefined});
    if (!r.ok){ const j = await r.json().catch(() => ({})); const e = Error(j.message || `Cloud error ${r.status}`); e.status = r.status; e.code = j.code; throw e; }
    return r.status === 204 ? null : r.json();
  }
  async function signIn(email, password){ keep(await authCall('token?grant_type=password', {email, password})); household = null; }
  function signOut(){ session = null; household = null; lsSet('inkscan.session', null); }
  async function owner(){
    if (!session) return null;
    if (household?.for === session.uid) return household.owner;
    let h = null;
    try { h = await rest('GET', 'rpc/inkscan_household'); } catch(e){ /* no family tables: own rows */ }
    household = {for: session.uid, owner: h?.owner || session.uid};
    return household.owner;
  }

  /* ---------- card catalogs ---------- */
  // IndexedDB keeps MTG card data between visits (thousands of cards; too big for localStorage).
  const idb = (() => {
    let dbp = null;
    const open = () => dbp || (dbp = new Promise((res, rej) => { const q = indexedDB.open('inkscan-portal', 1); q.onupgradeneeded = () => q.result.createObjectStore('cards'); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }));
    return {
      async getAll(){ const db = await open(); return new Promise((res, rej) => { const out = []; const c = db.transaction('cards').objectStore('cards').openCursor(); c.onsuccess = () => { const cur = c.result; if (cur){ out.push(cur.value); cur.continue(); } else res(out); }; c.onerror = () => rej(c.error); }); },
      async putMany(list){ const db = await open(); return new Promise((res, rej) => { const tx = db.transaction('cards', 'readwrite'); const s = tx.objectStore('cards'); for (const c of list) s.put(c, c.id); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); }
    };
  })();
  let sfLast = 0;
  async function scryfall(path, opts){
    const gap = path.startsWith('/cards/collection') ? 300 : 110;
    for (let attempt = 0; ; attempt++){
      const wait = sfLast + gap - Date.now(); if (wait > 0) await sleep(wait); sfLast = Date.now();
      let r = null;
      try { r = await fetch(SCRYFALL + path, {headers: {Accept: 'application/json', ...(opts?.body ? {'Content-Type': 'application/json'} : {})}, ...(opts || {})}); }
      catch(e){ if (attempt >= 3) throw e; }
      if (r){ if (r.status === 404) return null; if (r.ok) return r.json(); if (!(r.status === 429 || r.status >= 500) || attempt >= 3) throw Error(`Scryfall answered ${r.status}`); }
      await sleep([1500, 4000, 9000][attempt]);
    }
  }

  function nvKeyOf(game, c){ const g = G.get(game); return game === 'lorcana' || !g.nvKey ? norm(c.n) + '|' + norm(c.v) : g.nvKey(c); }

  class Catalog {
    constructor(game){ this.game = game; this.byId = new Map(); this.byNV = new Map(); this.sets = new Map(); }
    add(c){
      if (this.byId.has(c.id)) return false;
      if (c.sn && !this.sets.has(c.s)) this.sets.set(c.s, c.sn);
      c.nv = nvKeyOf(this.game, c); c.inks = String(c.i || '').split('/').filter(Boolean);
      this.byId.set(c.id, c); (this.byNV.get(c.nv) || this.byNV.set(c.nv, []).get(c.nv)).push(c);
      return true;
    }
    rep(nv){ const l = this.byNV.get(nv); return l ? l[0] : null; }
  }
  const catalogs = {};
  async function baseCatalog(game){
    if (catalogs[game]) return catalogs[game];
    const cat = new Catalog(game);
    const file = game === 'lorcana' ? '../cards.json' : G.get(game).catalog ? '../' + G.get(game).catalog : null;
    if (file){
      const d = await (await fetch(file)).json();
      for (const s of d.sets || []) cat.sets.set(s.code, s.name);
      for (const c of d.cards) cat.add(c);
    } else {
      for (const c of await idb.getAll().catch(() => [])) if (c && c.id?.startsWith('sf_') && Date.now() - (c._at || 0) < 7 * 864e5) cat.add(c);
    }
    return (catalogs[game] = cat);
  }
  let nameIndex = null;
  // MTG: fetch any card we hold or a deck names that isn't cached yet. Ids by id, deck keys by name.
  async function fillMtg(cat, ids, nvs, progress){
    const now = Date.now(), fresh = [];
    const take = list => { for (const raw of list || []){ const c = G.get('mtg').fromScryfall(raw); c._at = now; if (cat.add(c)) fresh.push(c); } };
    const needIds = [...new Set(ids)].filter(id => id.startsWith('sf_') && !cat.byId.has(id));
    let done = 0; const total = needIds.length + nvs.filter(nv => !cat.byNV.has(nv)).length;
    for (let i = 0; i < needIds.length; i += 75){
      const j = await scryfall('/cards/collection', {method: 'POST', body: JSON.stringify({identifiers: needIds.slice(i, i + 75).map(id => ({id: id.slice(3)}))})});
      take(j?.data); done += Math.min(75, needIds.length - i); progress?.(done, total);
    }
    const needNV = [...new Set(nvs)].filter(nv => !cat.byNV.has(nv));
    if (needNV.length){
      if (!nameIndex){
        const j = await scryfall('/catalog/card-names'); nameIndex = new Map();
        for (const n of j?.data || []){ const k = norm(n) + '|'; if (!nameIndex.has(k)) nameIndex.set(k, n); }
      }
      const names = [...new Set(needNV.map(nv => nameIndex.get(nv)).filter(Boolean).map(n => n.split(' // ')[0]))];
      for (let i = 0; i < names.length; i += 75){
        const j = await scryfall('/cards/collection', {method: 'POST', body: JSON.stringify({identifiers: names.slice(i, i + 75).map(name => ({name}))})});
        take(j?.data); done += Math.min(75, names.length - i); progress?.(done, total);
      }
      // The printing Scryfall returns for a name is sometimes unpriced (new basics, promos). Find the cheapest priced one.
      const wanted = new Set(needNV);
      for (const c of fresh.filter(x => wanted.has(x.nv) && x.p == null && x.pf == null).slice(0, 80)){
        const j = await scryfall('/cards/search?order=usd&dir=asc&unique=prints&q=' + encodeURIComponent(`!"${c.n.split(' // ')[0]}" usd>0 -is:digital`));
        take((j?.data || []).slice(0, 1));
      }
    }
    if (fresh.length) await idb.putMany(fresh).catch(() => {});
    return fresh.length;
  }

  /* ---------- the loaded state for one game ---------- */
  const state = {game: null, inv: new Map(), wish: new Map(), decks: [], cat: null, loadedAt: null};

  async function pullAll(table, game, own){
    const key = table === 'decks' ? 'id' : 'card_id', out = [];
    for (let offset = 0; ; offset += 1000){
      const page = await rest('GET', `${table}?user_id=eq.${encodeURIComponent(own)}&game=eq.${game}&select=*&order=${key}.asc&limit=1000&offset=${offset}`);
      out.push(...page); if (page.length < 1000) return out;
    }
  }
  function deckFromRow(r){
    const m = r.meta && typeof r.meta === 'object' && !Array.isArray(r.meta) ? r.meta : {};
    return {id: r.id, name: r.name, cards: r.cards || {}, commanders: r.commanders || [], meta: m, updated_at: r.updated_at,
      built: !!m.built, fav: !!m.fav, format: m.format || null, bracket: m.bracket || null, guide: m.guide || null};
  }
  async function load(game, progress){
    const own = await owner();
    const [inv, wish, decks, cat] = await Promise.all([pullAll('collection', game, own), pullAll('wishlist', game, own), pullAll('decks', game, own), baseCatalog(game)]);
    state.game = game; state.cat = cat;
    state.inv = new Map(inv.map(r => [r.card_id, {q: r.q || 0, f: r.f || 0, rf: r.rainbow_foil || 0}]));
    state.wish = new Map(wish.filter(r => r.qty > 0).map(r => [r.card_id, r.qty]));
    state.decks = decks.filter(r => !r.deleted).map(deckFromRow);
    if (game === 'mtg'){
      const nvs = state.decks.flatMap(d => Object.keys(d.cards));
      await fillMtg(cat, [...state.inv.keys(), ...state.wish.keys()], nvs, progress);
    }
    state.loadedAt = Date.now();
    rebuildOwnership();
    return state;
  }

  /* ---------- ownership and prices ---------- */
  let ownedByNV = new Map();
  function rebuildOwnership(){
    ownedByNV = new Map();
    for (const [id, v] of state.inv){ const c = state.cat.byId.get(id); if (!c) continue; ownedByNV.set(c.nv, (ownedByNV.get(c.nv) || 0) + v.q + v.f + v.rf); }
  }
  const ownedNV = nv => ownedByNV.get(nv) || 0;
  function committedNV(nv, exceptId){ let n = 0; for (const d of state.decks) if (d.built && d.id !== exceptId) n += d.cards[nv] || 0; return n; }
  const freeNV = (nv, exceptId) => Math.max(0, ownedNV(nv) - committedNV(nv, exceptId));
  const num = v => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
  // Cheapest known printing of a card (normal first, then foil), for buying.
  function cheapest(nv){ let m = null; for (const c of state.cat.byNV.get(nv) || []){ if (c.dg) continue; const p = num(c.p) ?? num(c.pf); if (p != null && (m == null || p < m)) m = p; } return m; }
  function ownedValue(id, v){ const c = state.cat.byId.get(id); if (!c) return {value: 0, unpriced: v.q + v.f + v.rf};
    let value = 0, unpriced = 0; const add = (n, p) => { if (!n) return; if (p == null) unpriced += n; else value += n * p; };
    add(v.q, num(c.p)); add(v.f, num(c.pf) ?? num(c.p)); add(v.rf, num(c.prf) ?? num(c.pe) ?? num(c.pf)); return {value, unpriced}; }

  function deckStats(d){
    const rows = []; let total = 0, unknown = 0, missing = 0, missCost = 0, missUnpriced = 0, have = 0;
    for (const [nv, q] of Object.entries(d.cards)){
      const c = state.cat.rep(nv), free = freeNV(nv, d.id), need = Math.max(0, q - free), price = c ? cheapest(nv) : null;
      total += q; missing += need; have += q - need;
      if (!c) unknown += q;
      if (need){ if (price == null) missUnpriced += need; else missCost += need * price; }
      rows.push({nv, q, c, owned: ownedNV(nv), free, need, price, commander: d.commanders.includes(nv)});
    }
    const g = G.get(state.game), fmt = state.game === 'mtg' && d.format ? g.formats[d.format] : null;
    const size = fmt?.size || (state.game === 'mtg' ? (d.commanders.length ? 100 : 60) : g.deck.size);
    return {rows, total, unknown, missing, missCost, missUnpriced, have, size, pct: total ? have / total : 0};
  }

  /* ---------- writes: decks only ---------- */
  function newId(){ return 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  async function saveDeck(d){
    const own = await owner(), meta = {...(d.meta || {})};
    for (const k of ['built', 'fav']) if (d[k]) meta[k] = true; else delete meta[k];
    if (d.format) meta.format = d.format; else delete meta.format;
    if (d.guide) meta.guide = d.guide;
    const row = {user_id: own, game: state.game, id: d.id, name: d.name, cards: d.cards, commanders: d.commanders || [], meta, deleted: false};
    let res;
    if (d.updated_at){
      // Only overwrite the version we loaded; if the phone changed it since, stop instead of clobbering.
      res = await rest('PATCH', `decks?user_id=eq.${encodeURIComponent(own)}&game=eq.${state.game}&id=eq.${encodeURIComponent(d.id)}&updated_at=eq.${encodeURIComponent(d.updated_at)}`, row, {Prefer: 'return=representation'});
      if (!Array.isArray(res) || res.length !== 1) throw Error('This deck changed somewhere else since it was loaded. Reload to get the latest version, then make the change again.');
    } else {
      res = await rest('POST', 'decks', row, {Prefer: 'return=representation'});
    }
    const saved = deckFromRow(res[0]), i = state.decks.findIndex(x => x.id === saved.id);
    if (i >= 0) state.decks[i] = saved; else state.decks.push(saved);
    return saved;
  }

  /* ---------- card lookup for adding cards and for the advisor ---------- */
  async function searchCards(game, query, limit){
    limit = Math.max(1, Math.min(50, limit || 20));
    const cat = state.game === game && state.cat ? state.cat : await baseCatalog(game);
    if (game === 'mtg'){
      const j = await scryfall('/cards/search?order=name&q=' + encodeURIComponent(query));
      const list = (j?.data || []).slice(0, limit).map(raw => { const c = G.get('mtg').fromScryfall(raw); c._at = Date.now(); cat.add(c); return cat.byId.get(c.id); });
      idb.putMany(list).catch(() => {});
      return {cards: list, total: j?.total_cards || list.length};
    }
    const q = norm(query), words = String(query).toLowerCase().split(/\s+/).filter(Boolean), seen = new Set(), out = [];
    for (const list of cat.byNV.values()){
      const c = list[0], hay = `${c.n} ${c.v || ''} ${c.ty || ''} ${c.cl || ''} ${c.tx || ''}`.toLowerCase();
      if ((norm(c.n + (c.v || '')).includes(q) || words.every(w => hay.includes(w))) && !seen.has(c.nv)){ seen.add(c.nv); out.push(c); }
    }
    out.sort((a, b) => (norm(a.n).startsWith(q) ? 0 : 1) - (norm(b.n).startsWith(q) ? 0 : 1) || a.n.localeCompare(b.n));
    return {cards: out.slice(0, limit), total: out.length};
  }
  // Resolve a typed name (from the advisor or a pasted list) to a deck key.
  async function resolveName(game, name){
    const cat = state.cat;
    if (game === 'mtg'){
      const nv = norm(String(name).split(' // ')[0]) + '|';
      for (const k of [norm(name) + '|', nv]) if (cat.byNV.has(k)) return k;
      const j = await scryfall('/cards/named?fuzzy=' + encodeURIComponent(name));
      if (!j) return null; const c = G.get('mtg').fromScryfall(j); c._at = Date.now(); cat.add(c); idb.putMany([c]).catch(() => {});
      return c.nv;
    }
    const want = norm(name);
    for (const [nv, list] of cat.byNV){ const c = list[0]; if (norm(c.n + (c.v || '')) === want || norm(c.n + ' - ' + (c.v || '')) === want || (game !== 'lorcana' && norm(c.n) === want)) return nv; }
    const loose = [...cat.byNV.keys()].filter(k => k.startsWith(norm(String(name).split(/\s+-\s+/)[0]) + '|'));
    return loose.length === 1 ? loose[0] : null;
  }

  root.PortalData = {state, session: () => session, signIn, signOut, owner, load, deckStats, ownedNV, freeNV, committedNV, cheapest, ownedValue,
    saveDeck, newId, searchCards, resolveName, nvKeyOf, cloudAllowed, token, SB_URL, SB_KEY, lsGet, lsSet};
})(self);
